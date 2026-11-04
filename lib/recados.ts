import db from "@/lib/db";
import { isBlockedEither } from "@/lib/blocks";
import { canNetwork } from "@/lib/network";
import { notify } from "@/lib/notifications";
import { createPost, hydratePosts, listPostIds, type Post } from "@/lib/posts";
import type { Member } from "@/lib/members";
import { RecadoError, cleanRecado, recadoClosedText } from "@/lib/recadosText";

// Regras de texto e o vocabulário de recadosFrom moram em lib/recadosText.ts
// (módulo puro, usado também pelo formulário no cliente). Daqui pra baixo é o
// que fala com o banco.
export {
  RECADO_MAX,
  RECADOS_FROM,
  RecadoError,
  cleanRecado,
  isRecadosFrom,
  recadoClosedText,
  type RecadosFrom,
} from "@/lib/recadosText";

// Recado no perfil (spec 046, perfil-rico; estudo 044 §1.4).
//
// Reaproveita `posts` com o escopo profileId (migration 041) em vez de criar
// tabela: edição, resposta (comentário de 1 nível), moderação e denúncia
// (reports targetType 'post') já existem. O que este módulo guarda é o que é
// só do recado:
//
// - texto puro até RECADO_MAX (280), sem markdown. Quem mostra escapa (React)
//   e link continua sendo link externo com nofollow (PostCard).
// - reação fica desligada: recado não é post de mural (a rota de reação
//   recusa recado e o card não mostra os botões).
// - quem escreve é configurável em members.recadosFrom:
//     conexoes (padrão)  mesmo time, mesma edição com check-in, mesma
//                        comunidade ou seguir mútuo
//     todos              qualquer conta ativa, sem bloqueio
//     ninguem            ninguém (o dono também não escreve no próprio perfil)
// - dono apaga qualquer recado do próprio perfil (canModeratePost em
//   lib/posts.ts) e o autor apaga o seu.
// - anti-corrente (lição do worm de 2007): 10 por hora e 1 por minuto pra
//   mesma pessoa (lib/ratelimit, na rota); o mesmo texto mandado pra mais de
//   RECADO_SAME_TEXT_PROFILES perfis em 1 h é barrado aqui.
// - sem contador público de recados: a tela mostra os últimos 10 e "ver mais".
// - aviso agrupado ("3 recados novos"): notify type 'recado', que já tem
//   frase plural em lib/notifications.ts.
// - conta excluída leva os recados junto: o autor está em posts.memberId
//   (OWNER_COLUMNS) e quem recebe em posts.profileId (PEER_COLUMNS).

export const RECADO_PAGE = 10;
/** mesmo texto pra mais que isso de perfis em 1 h é corrente, não recado */
export const RECADO_SAME_TEXT_PROFILES = 5;

export type RecadoPermission = { ok: true } | { ok: false; reason: "ninguem" | "conexoes" | "bloqueado" };

/**
 * Uma consulta pra decidir "tem laço": mesmo time, mesma edição com check-in
 * dos dois, mesma comunidade ou seguir mútuo.
 */
async function hasTie(a: number, b: number): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS ok WHERE
        EXISTS (SELECT 1 FROM team_members ta
                JOIN team_members tb ON tb.teamId = ta.teamId
                WHERE ta.username = (SELECT username FROM members WHERE id = @a)
                  AND tb.username = (SELECT username FROM members WHERE id = @b))
        OR EXISTS (SELECT 1 FROM registrations ra
                   JOIN checkins ka ON ka.registrationId = ra.id
                   JOIN registrations rb ON rb.hackathonId = ra.hackathonId AND rb.memberId = @b AND rb.status = 'approved'
                   JOIN checkins kb ON kb.registrationId = rb.id
                   WHERE ra.memberId = @a AND ra.status = 'approved')
        OR EXISTS (SELECT 1 FROM community_members ca
                   JOIN community_members cb ON cb.communityId = ca.communityId AND cb.memberId = @b
                   WHERE ca.memberId = @a)
        OR (EXISTS (SELECT 1 FROM member_follows f WHERE f.memberId = @a AND f.followedId = @b)
            AND EXISTS (SELECT 1 FROM member_follows g WHERE g.memberId = @b AND g.followedId = @a))`,
    )
    .get<{ ok: number }>({ a, b });
  return !!row;
}

/**
 * Pode authorId deixar recado no perfil de target? Bloqueio em qualquer
 * sentido e conta fora de canNetwork valem como "não existe" (404 na rota);
 * aqui só sobra a regra de recadosFrom.
 */
export async function canWriteRecado(
  author: Pick<Member, "id">,
  target: Pick<Member, "id" | "recadosFrom">,
): Promise<RecadoPermission> {
  if (author.id === target.id) return { ok: false, reason: "ninguem" };
  if (await isBlockedEither(author.id, target.id)) return { ok: false, reason: "bloqueado" };
  if (!(await canNetwork(author.id)) || !(await canNetwork(target.id))) return { ok: false, reason: "bloqueado" };
  if (target.recadosFrom === "ninguem") return { ok: false, reason: "ninguem" };
  if (target.recadosFrom === "todos") return { ok: true };
  return (await hasTie(author.id, target.id)) ? { ok: true } : { ok: false, reason: "conexoes" };
}

/**
 * O mesmo texto já foi pra mais de RECADO_SAME_TEXT_PROFILES perfis na última
 * hora? Devolve quantos perfis distintos receberam.
 */
export async function sameTextProfiles(authorId: number, body: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(DISTINCT profileId)::int AS n FROM posts
       WHERE memberId = @m AND profileId IS NOT NULL AND body = @body
         AND to_ts(createdAt) >= now() - interval '1 hour'`,
    )
    .get<{ n: number }>({ m: authorId, body });
  return Number(row?.n ?? 0);
}

export type RecadoTarget = Pick<Member, "id" | "username" | "recadosFrom">;

/**
 * Escreve o recado e avisa quem recebe. Erros: 400 (texto), 403 (sem laço ou
 * recados desligados), 404 (bloqueio/conta fora), 429 (mesmo texto em
 * corrente). Os limites de 10/h e 1/min ficam na rota (lib/ratelimit).
 */
export async function writeRecado(author: Member, target: RecadoTarget, rawBody: unknown): Promise<Post> {
  const body = cleanRecado(rawBody);
  if (author.id === target.id) throw new RecadoError("Você não deixa recado no próprio perfil.", 400);
  const perm = await canWriteRecado(author, target);
  if (!perm.ok) {
    if (perm.reason === "bloqueado") throw new RecadoError("Pessoa não encontrada.", 404);
    throw new RecadoError(recadoClosedText(perm.reason), 403);
  }
  if ((await sameTextProfiles(author.id, body)) >= RECADO_SAME_TEXT_PROFILES) {
    throw new RecadoError("O mesmo recado pra tanta gente não é recado. Escreva um pra cada.", 429);
  }
  const post = await createPost(author.id, body, null, null, null, target.id);
  await notify(target.id, {
    type: "recado",
    actorId: author.id,
    actorUsername: author.username,
    text: `@${author.username} deixou um recado no seu perfil`,
    href: `/u/${target.username}?recados=todos`,
  });
  return post;
}

/**
 * Recados do perfil, do mais novo pro mais antigo. Cursor `antes` = id do
 * último recado da página anterior. Bloqueio e silêncio de quem lê valem
 * (hiddenAuthorSql em listPostIds).
 */
export async function listRecados(
  profileId: number,
  viewerId: number | null,
  opts: { antes?: number | null; limit?: number } = {},
): Promise<Post[]> {
  const ids = await listPostIds({ kind: "profile", id: profileId }, viewerId, {
    antes: opts.antes ?? null,
    limit: opts.limit ?? RECADO_PAGE,
  });
  return hydratePosts(ids, viewerId);
}

/** só o id do último recado da página, pro "ver mais" */
export async function recadoCursor(
  profileId: number,
  viewerId: number | null,
  limit = RECADO_PAGE,
): Promise<number | null> {
  const ids = await listPostIds({ kind: "profile", id: profileId }, viewerId, { limit: limit + 1 });
  return ids.length > limit ? ids[limit - 1] : null;
}

/** o recado é um recado? (rota de reação e card usam pra desligar like) */
export const isRecado = (post: { profileId: number | null }): boolean => post.profileId !== null;
