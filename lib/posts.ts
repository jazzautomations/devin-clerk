import db from "@/lib/db";
import type { Member } from "@/lib/members";
import { hiddenAuthorSql, isBlockedEither } from "@/lib/blocks";
import { canManageCommunity } from "@/lib/communities";
import { canManageEdition, hasEditionRole } from "@/lib/roles";
import { resolveInternalLink, type LinkCard } from "@/lib/linkCard";
import { REACTION_KINDS, REACTION_LABEL, isReactionKind, type ReactionKind } from "@/lib/reactions";
import { syncMentionsAndTags } from "@/lib/tags";

// Posts (spec 046, conversa no post, migration 034).
//
// CONTRATO pras próximas ondas (timeline, menções, perfil, projeto vivo,
// repost, espaços):
//
// - listPostIds(scope, meId, {antes?, limit, includeHidden?}) devolve ids em
//   ordem id DESC, com cursor `antes` (id exclusivo), sem autores de
//   hiddenIdsFor(meId) (bloqueio nos dois sentidos e silêncio) e, em todo
//   escopo, sem post de espaço fora do ar: comunidade escondida, edição de
//   comunidade escondida e edição inativa. includeHidden: true desliga esse
//   filtro e é só pra rota que já conferiu que quem lê pode ver o espaço
//   (admin na comunidade escondida, equipe da edição).
// - hydratePosts(ids, meId) devolve Post[] na ordem dos ids, com reações,
//   minha reação, contagem de comentários, editedAt, linkCard e canModerate.
//   Feature que precisa de outro filtro (tag, time, espaço) escreve a própria
//   query de ids e chama hydratePosts: ninguém monta Post na mão.
// - canModeratePost(member, post) é a regra única de quem apaga post ou
//   comentário: autor, admin global, dono ou organizador da comunidade do
//   post e organizador ou staff da edição do post.
// - components/PostCard.tsx é o único lugar que renderiza post.
// - Repost e citação (migration 049) são posts: repost tem body '' e
//   repostOfId, citação tem corpo próprio e quoteOfId. shareTarget() é a
//   regra única de "dá pra compartilhar isso?" (404 pra bloqueio, 400 pra
//   espaço fora do ar e recado); a rota decide o resto. Quem lista não monta
//   o cabeçalho na mão: hydratePosts já traz repostOf/quoteOf hidratados,
//   shareCount, repostedByMe e sharedBy.
// - O escopo `team` (migration 044) é o diário do projeto: projeto vivo lista
//   por listPostIds({kind:"team"}) + hydratePosts e cria por createPost(...,
//   teamId). Post do diário não tem mural (hackathonId/communityId nulos): o
//   espaço dele é a página do projeto.
//
// Like não dá XP nem badge (plano 046, naoFazer): reação é conversa.

export { REACTION_KINDS, REACTION_LABEL, isReactionKind, type ReactionKind };

export const POST_LIMITS = { body: 500, link: 500 } as const;

export type Post = {
  id: number;
  /** autor */
  memberId: number;
  body: string;
  link: string | null;
  createdAt: string;
  editedAt: string | null;
  hackathonId: string | null;
  hackathonName: string | null;
  // mural da comunidade (migration 027)
  communityId: number | null;
  communityName: string | null;
  communitySlug: string | null;
  /** recado no perfil (migration 041): quem recebe. null = post normal */
  profileId: number | null;
  username: string;
  name: string | null;
  avatarUrl: string | null;
  headline: string | null;
  persona: string | null;
  xp: number;
  reactions: Record<ReactionKind, number>;
  myReaction: ReactionKind | null;
  /** total de reações (compatibilidade com o like antigo) */
  likeCount: number;
  /** tenho alguma reação no post (compatibilidade) */
  likedByMe: boolean;
  commentCount: number;
  /** card do link interno (/p, /h, /u, /comunidade) quando visível pra quem lê */
  linkCard: LinkCard | null;
  /** @ que existem de verdade no corpo do post (migration 039) — viram link */
  mentionedUsernames: string[];
  /** quem lê pode apagar (canModeratePost) */
  canModerate: boolean;
  /** repost puro (migration 049): o post compartilhado. body vazio. */
  repostOfId: number | null;
  /** citação (migration 049): o post citado. Com quoteOfId e sem quoteOf = post apagado */
  quoteOfId: number | null;
  /** a pessoa aceita citação deste post */
  allowQuote: boolean;
  /** quantos reposts este post tem (o contador de "compartilhar") */
  shareCount: number;
  /** eu já repostei este post (o botão é toggle) */
  repostedByMe: boolean;
  /** quem repostou, só com @ de quem quem lê ainda vê ("@a e @b compartilharam") */
  sharedBy: string[];
  /** o original repostado, hidratado (null com repostOfId preenchido = indisponível) */
  repostOf: Post | null;
  /** o post citado, hidratado (null com quoteOfId preenchido = post apagado) */
  quoteOf: Post | null;
};

/**
 * Onde o post mora. `global` é o feed agregado (tudo que é visível:
 * global, edições e comunidades); `member` são os posts que a pessoa
 * escreveu; `profile` são os recados deixados no perfil de alguém
 * (migration 041). `solto` é só o post sem edição nem comunidade.
 *
 * Recado nunca entra em `global`, `member` nem `solto`: quem lista recado
 * pede o escopo `profile`. `team` é o diário do projeto (migration 044):
 * o post não tem mural, o espaço dele é o projeto em /p/[teamId].
 */
export type PostScope =
  | { kind: "global" }
  | { kind: "hackathon"; id: string }
  | { kind: "community"; id: number }
  | { kind: "member"; id: number }
  | { kind: "profile"; id: number }
  | { kind: "team"; id: number };

/** escopo do listPosts antigo (spec 028), mantido pra quem já chama */
export type LegacyPostScope = { hackathonId: string } | { communityId: number } | { global: true };

type ScopeArg = PostScope | { kind: "solto" };

const emptyReactions = (): Record<ReactionKind, number> => ({ curti: 0, ajudou: 0, quero_testar: 0, aprendi: 0 });

// post visível = o espaço dele está no ar. Post de mural de edição tem
// communityId NULL: a comunidade dele é a da edição (hackathons.communityId).
// Exportado pra quem escreve a própria query de ids (tag, lib/tags.ts): a
// regra de visibilidade é uma só.
export function spaceUpSql(alias = "p"): string {
  return `NOT EXISTS (SELECT 1 FROM communities co WHERE co.id = ${alias}.communityId AND co.hidden = 1)
  AND NOT EXISTS (SELECT 1 FROM hackathons hh LEFT JOIN communities hc ON hc.id = hh.communityId
    WHERE hh.id = ${alias}.hackathonId AND (hh.active = 0 OR hc.hidden = 1))`;
}

const SPACE_UP_SQL = spaceUpSql();

/**
 * Repost cujo original quem lê não vê mais (autor bloqueado ou silenciado,
 * comunidade escondida, edição fora do ar) não entra em lista nenhuma: o
 * conteúdo do repost É o do original. Exportado porque a timeline escreve a
 * própria query de ids com a mesma regra.
 */
export function shareOriginUpSql(alias = "p"): string {
  return `NOT EXISTS (SELECT 1 FROM posts o WHERE o.id = ${alias}."repostOfId"
    AND NOT (${spaceUpSql("o")} AND ${hiddenAuthorSql("o.memberId")}))`;
}

const SHARE_ORIGIN_UP_SQL = shareOriginUpSql();

export type ListOpts = { antes?: number | null; limit?: number; includeHidden?: boolean };

export async function listPostIds(scope: ScopeArg, meId: number | null, opts: ListOpts = {}): Promise<number[]> {
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 200));
  const params: Record<string, unknown> = { me: meId ?? -1, limit };
  const where: string[] = [];
  switch (scope.kind) {
    case "global":
      break;
    case "hackathon":
      where.push("p.hackathonId = @scopeH");
      params.scopeH = scope.id;
      break;
    case "community":
      where.push("p.communityId = @scopeC");
      params.scopeC = scope.id;
      break;
    case "member":
      where.push("p.memberId = @scopeM");
      params.scopeM = scope.id;
      break;
    case "profile":
      where.push("p.profileId = @scopeP");
      params.scopeP = scope.id;
      break;
    case "team":
      where.push("p.teamId = @scopeT");
      params.scopeT = scope.id;
      break;
    case "solto":
      where.push("p.hackathonId IS NULL AND p.communityId IS NULL AND p.teamId IS NULL");
      break;
  }
  // recado (migration 041) só aparece no escopo do perfil: fora dele é como
  // se não existisse (feed, atividade, mural de edição e de comunidade)
  if (scope.kind !== "profile") where.push("p.profileId IS NULL");
  if (!opts.includeHidden) where.push(SPACE_UP_SQL);
  // repost de post que não posso mais ver não aparece (migration 049)
  where.push(SHARE_ORIGIN_UP_SQL);
  if (meId) where.push(hiddenAuthorSql("p.memberId"));
  if (opts.antes) {
    where.push("p.id < @antes");
    params.antes = opts.antes;
  }
  const rows = await db
    .prepare(
      `SELECT p.id FROM posts p ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY p.id DESC LIMIT @limit`,
    )
    .all<{ id: number }>(params);
  return rows.map((r) => Number(r.id));
}

type PostRow = Omit<
  Post,
  | "reactions"
  | "myReaction"
  | "likeCount"
  | "likedByMe"
  | "linkCard"
  | "canModerate"
  | "repostOf"
  | "quoteOf"
  | "sharedBy"
  | "allowQuote"
> & {
  myReaction: string | null;
  mentionedUsernames: string[] | string | null;
  sharedBy: string[] | string | null;
  allowQuote: number;
  repostedByMe: boolean;
};

const SELECT = `SELECT p.id, p.memberId, p.body, p.link, p.createdAt, p.editedAt, p.hackathonId,
       h.name AS hackathonName, p.communityId, co.name AS "communityName", co.slug AS "communitySlug",
       p.profileId, p."repostOfId", p."quoteOfId", p."allowQuote",
       -- compartilhamento (migration 049): quantos reposts, se eu já repostei
       -- e quem repostou (o cabeçalho "@a e @b compartilharam")
       (SELECT COUNT(*) FROM posts r WHERE r."repostOfId" = p.id) AS "shareCount",
       EXISTS (SELECT 1 FROM posts r WHERE r."repostOfId" = p.id AND r.memberId = @me) AS "repostedByMe",
       COALESCE((SELECT array_agg(rm.username ORDER BY r.id)
         FROM posts r JOIN members rm ON rm.id = r.memberId
         WHERE r."repostOfId" = p.id AND ${hiddenAuthorSql("rm.id")}), '{}') AS "sharedBy",
       m.username, m.name, m.avatarUrl, m.headline, m.persona, m.xp,
       (SELECT l.kind FROM likes l WHERE l.postId = p.id AND l.memberId = @me) AS "myReaction",
       (SELECT COUNT(*) FROM post_comments c WHERE c.postId = p.id AND ${hiddenAuthorSql("c.memberId")}
          AND (c.parentId IS NULL OR EXISTS (SELECT 1 FROM post_comments pc WHERE pc.id = c.parentId AND ${hiddenAuthorSql("pc.memberId")}))) AS "commentCount",
       -- menção do corpo do post (migration 039): só as de gente que quem lê
       -- ainda vê. Menção de bloqueado/silenciado fica texto, não link.
       COALESCE((SELECT array_agg(mt.username ORDER BY mt.username)
         FROM post_mentions pm JOIN members mt ON mt.id = pm.memberId
         WHERE pm.postId = p.id AND pm.commentId IS NULL AND ${hiddenAuthorSql("mt.id")}), '{}') AS "mentionedUsernames"
       FROM posts p JOIN members m ON m.id = p.memberId
       LEFT JOIN hackathons h ON h.id = p.hackathonId
       LEFT JOIN communities co ON co.id = p.communityId`;

/** text[] do Postgres em array de JS, venha ele como array ou como literal "{a,b}" */
export function textArray(v: string[] | string | null | undefined): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  if (typeof v !== "string" || !v) return [];
  return v
    .replace(/^\{|\}$/g, "")
    .split(",")
    .map((s) => s.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
}

type Viewer = { id: number; role: string } | null;

async function viewerOf(meId: number | null): Promise<Viewer> {
  if (!meId) return null;
  return (await db.prepare("SELECT id, role FROM members WHERE id = ?").get<{ id: number; role: string }>(meId)) ?? null;
}

/** espaços que o leitor modera, numa ida ao banco cada (sem N+1 no feed) */
async function moderatedSpaces(viewer: Viewer): Promise<{ communities: Set<number>; editions: Set<string> }> {
  if (!viewer || viewer.role === "admin") return { communities: new Set(), editions: new Set() };
  const [cs, es] = await Promise.all([
    db
      .prepare("SELECT communityId FROM community_members WHERE memberId = ? AND role IN ('dono', 'organizador')")
      .all<{ communityId: number }>(viewer.id),
    db
      .prepare("SELECT DISTINCT hackathonId FROM edition_roles WHERE memberId = ? AND role IN ('organizador', 'staff')")
      .all<{ hackathonId: string }>(viewer.id),
  ]);
  return { communities: new Set(cs.map((r) => Number(r.communityId))), editions: new Set(es.map((r) => r.hackathonId)) };
}

/**
 * Post hidratado na ordem dos ids. O original de um repost ou de uma citação
 * vem junto (uma consulta a mais por página, não por post): o card mostra o
 * original embaixo, com as reações e o link dele.
 */
export async function hydratePosts(ids: number[], meId: number | null): Promise<Post[]> {
  return hydrateDepth(ids, meId, 0);
}

/** original de repost/citação hidratado; o original de um original, não */
const HYDRATE_ORIGIN_DEPTH = 1;

/**
 * Dos ids, só os que quem lê ainda pode ver (espaço no ar e autor não
 * bloqueado/silenciado). O original de um repost ou de uma citação passa por
 * aqui: quem não vê o original não vê o repost nem a caixa da citação.
 */
async function visibleIds(ids: number[], meId: number | null): Promise<number[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .prepare(
      `SELECT p.id FROM posts p WHERE p.id = ANY(@ids::int[]) AND ${SPACE_UP_SQL} AND ${hiddenAuthorSql("p.memberId")}`,
    )
    .all<{ id: number }>({ ids, me: meId ?? -1 });
  return rows.map((r) => Number(r.id));
}

async function hydrateDepth(ids: number[], meId: number | null, depth: number): Promise<Post[]> {
  const clean = [...new Set(ids.filter((n) => Number.isSafeInteger(n) && n > 0))];
  if (clean.length === 0) return [];
  const [rows, counts, viewer] = await Promise.all([
    db.prepare(`${SELECT} WHERE p.id = ANY(@ids::int[])`).all<PostRow>({ me: meId ?? -1, ids: clean }),
    db
      .prepare(`SELECT postId, kind, COUNT(*) AS n FROM likes WHERE postId = ANY(?::int[]) GROUP BY postId, kind`)
      .all<{ postId: number; kind: ReactionKind; n: number }>(clean),
    viewerOf(meId),
  ]);
  const spaces = await moderatedSpaces(viewer);
  const byPost = new Map<number, Record<ReactionKind, number>>();
  for (const c of counts) {
    const r = byPost.get(Number(c.postId)) ?? emptyReactions();
    if (isReactionKind(c.kind)) r[c.kind] = Number(c.n);
    byPost.set(Number(c.postId), r);
  }
  // o mesmo link em vários posts resolve uma vez só
  const cards = new Map<string, Promise<LinkCard | null>>();
  const cardFor = (link: string | null) => {
    if (!link) return Promise.resolve(null);
    if (!cards.has(link)) cards.set(link, resolveInternalLink(link, meId));
    return cards.get(link)!;
  };
  const byId = new Map<number, Post>();
  await Promise.all(
    rows.map(async (row) => {
      const reactions = byPost.get(Number(row.id)) ?? emptyReactions();
      const myReaction = isReactionKind(row.myReaction) ? row.myReaction : null;
      const likeCount = REACTION_KINDS.reduce((s, k) => s + reactions[k], 0);
      const canModerate =
        !!viewer &&
        (viewer.role === "admin" ||
          row.memberId === viewer.id ||
          // recado: o dono do perfil apaga qualquer um (migration 041)
          (row.profileId !== null && Number(row.profileId) === viewer.id) ||
          (row.communityId !== null && spaces.communities.has(Number(row.communityId))) ||
          (row.hackathonId !== null && spaces.editions.has(row.hackathonId)));
      byId.set(Number(row.id), {
        ...row,
        id: Number(row.id),
        memberId: Number(row.memberId),
        profileId: row.profileId == null ? null : Number(row.profileId),
        repostOfId: row.repostOfId == null ? null : Number(row.repostOfId),
        quoteOfId: row.quoteOfId == null ? null : Number(row.quoteOfId),
        allowQuote: Number(row.allowQuote) !== 0,
        shareCount: Number(row.shareCount),
        repostedByMe: Boolean(row.repostedByMe),
        sharedBy: textArray(row.sharedBy),
        repostOf: null,
        quoteOf: null,
        commentCount: Number(row.commentCount),
        mentionedUsernames: textArray(row.mentionedUsernames),
        reactions,
        myReaction,
        likeCount,
        likedByMe: myReaction !== null,
        linkCard: await cardFor(row.link),
        canModerate,
      });
    }),
  );
  const posts = clean.map((id) => byId.get(id)).filter((p): p is Post => !!p);
  if (depth < HYDRATE_ORIGIN_DEPTH) {
    // o original de repost/citação, só se eu ainda posso ver; o que já veio
    // na mesma página não repete
    const wanted = [
      ...new Set(posts.flatMap((p) => [p.repostOfId, p.quoteOfId]).filter((n): n is number => n !== null && !byId.has(n))),
    ];
    const originals = await hydrateDepth(await visibleIds(wanted, meId), meId, depth + 1);
    const byOrigin = new Map<number, Post>([...byId, ...originals.map((p) => [p.id, p] as const)]);
    for (const p of posts) {
      // null com o id preenchido = original apagado ou fora da minha vista
      p.repostOf = p.repostOfId === null ? null : (byOrigin.get(p.repostOfId) ?? null);
      p.quoteOf = p.quoteOfId === null ? null : (byOrigin.get(p.quoteOfId) ?? null);
    }
  }
  return posts;
}

function toListScope(scope?: LegacyPostScope | PostScope): ScopeArg {
  if (!scope) return { kind: "global" };
  if ("kind" in scope) return scope;
  if ("hackathonId" in scope) return { kind: "hackathon", id: scope.hackathonId };
  if ("communityId" in scope) return { kind: "community", id: scope.communityId };
  return { kind: "solto" };
}

// spec 028 — escopo do mural: omitido agrega tudo (/feed mostra global +
// edições e comunidades com chip, sem as comunidades escondidas);
// {hackathonId} isola a edição; {communityId} o mural da comunidade;
// {global} só posts sem edição nem comunidade
export async function listPosts(
  limit = 50,
  meId: number | null = null,
  scope?: LegacyPostScope | PostScope,
  opts: { includeHidden?: boolean } = {},
): Promise<Post[]> {
  return hydratePosts(await listPostIds(toListScope(scope), meId, { limit, ...opts }), meId);
}

/**
 * O post pra quem lê, ou null: não existe, um dos dois bloqueou o outro ou o
 * espaço dele está fora do ar. Comunidade escondida e edição inativa: só o
 * admin vê. Edição de comunidade escondida: admin e organização da edição
 * (a mesma regra de /h/[id]).
 */
export async function getPost(id: number, meId: number | null): Promise<Post | null> {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const row = await db
    .prepare(
      `SELECT p.memberId, p.hackathonId, p.profileId, COALESCE(co.hidden, 0) AS hidden,
              COALESCE(hh.active, 1) AS "editionActive", COALESCE(hc.hidden, 0) AS "editionHidden"
       FROM posts p
       LEFT JOIN communities co ON co.id = p.communityId
       LEFT JOIN hackathons hh ON hh.id = p.hackathonId
       LEFT JOIN communities hc ON hc.id = hh.communityId
       WHERE p.id = ?`,
    )
    .get<{ memberId: number; hackathonId: string | null; profileId: number | null; hidden: number; editionActive: number; editionHidden: number }>(id);
  if (!row) return null;
  const adminOnly = Number(row.hidden) === 1 || Number(row.editionActive) === 0;
  if (adminOnly || Number(row.editionHidden) === 1) {
    const viewer = await viewerOf(meId);
    if (!viewer) return null;
    if (adminOnly && viewer.role !== "admin") return null;
    if (!adminOnly && !(await canManageEdition(viewer, row.hackathonId!))) return null;
  }
  if (meId && (await isBlockedEither(meId, Number(row.memberId)))) return null;
  // recado (migration 041): bloqueio com o dono do perfil vale nos dois
  // sentidos, igual ao /u dele
  if (meId && row.profileId != null && (await isBlockedEither(meId, Number(row.profileId)))) return null;
  return (await hydratePosts([id], meId))[0] ?? null;
}

/** texto e link de post: as mesmas regras pra criar e editar */
export function validatePostInput(
  body: unknown,
  link: unknown,
  opts: { allowEmpty?: boolean } = {},
): { body: string; link: string | null } {
  const trimmed = typeof body === "string" ? body.trim().slice(0, POST_LIMITS.body) : "";
  // repost é o único post sem texto: o conteúdo dele é o do original
  if (!trimmed && !opts.allowEmpty) throw new Error("Post vazio");
  const url = typeof link === "string" ? link.trim() || null : null;
  if (url) {
    // externo com http(s) ou caminho do próprio HackaHub ("/p/12")
    const external = /^https?:\/\/[^\s]+$/i.test(url);
    const internal = /^\/(?![/\\])[^\s]*$/.test(url);
    if ((!external && !internal) || url.length > POST_LIMITS.link) throw new Error("Link inválido");
  }
  return { body: trimmed, link: url };
}

/** o que o post compartilha (migration 049): repost OU citação, nunca os dois */
export type PostShare = {
  /** repost puro: body vazio, aponta pro original */
  repostOfId?: number | null;
  /** citação: corpo próprio com o original na caixa */
  quoteOfId?: number | null;
  /** a pessoa aceita citação deste post (padrão sim) */
  allowQuote?: boolean;
};

export async function createPost(
  memberId: number,
  body: string,
  link?: string | null,
  hackathonId?: string | null,
  communityId?: number | null,
  profileId?: number | null,
  /** diário do projeto (migration 044); o time é validado na rota */
  teamId?: number | null,
  /** repost ou citação (migration 049); o alvo é validado por shareTarget */
  share: PostShare = {},
  /** espaço do mural da comunidade (migration 057); a rota valida dono do
   * espaço, arquivado e política, e resolve o geral quando não vem */
  spaceId?: number | null,
): Promise<Post> {
  const repostOfId = share.repostOfId ?? null;
  const quoteOfId = share.quoteOfId ?? null;
  if (repostOfId !== null && quoteOfId !== null) throw new Error("Post inválido");
  const v = validatePostInput(body, link, { allowEmpty: repostOfId !== null });
  // escopo é só persistido aqui — edição existe/ativa e inscrição do membro
  // são validados na rota, que tem os códigos HTTP (404/400/403). Recado
  // (profileId) passa por lib/recados.ts, que valida antes de chamar.
  const row = await db
    .prepare(
      `INSERT INTO posts (memberId, body, link, hackathonId, communityId, profileId, teamId, "repostOfId", "quoteOfId", "allowQuote", "spaceId")
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .get<{ id: number }>(
      memberId,
      v.body,
      v.link,
      hackathonId?.trim() || null,
      communityId ?? null,
      profileId ?? null,
      teamId ?? null,
      repostOfId,
      quoteOfId,
      share.allowQuote === false ? 0 : 1,
      spaceId ?? null,
    );
  await syncMentionsAndTags(row!.id, null, v.body, await actorOf(memberId));
  return (await hydratePosts([row!.id], memberId))[0];
}

/** @ e id de quem escreveu, pro aviso de menção e pro filtro de bloqueio */
async function actorOf(memberId: number): Promise<{ id: number; username: string }> {
  const row = await db.prepare("SELECT username FROM members WHERE id = ?").get<{ username: string }>(memberId);
  return { id: memberId, username: row?.username ?? "" };
}

/** o que o PATCH do post aceita: texto+link juntos e/ou a opção de citação */
export type PostPatch = { body?: unknown; link?: unknown; allowQuote?: unknown };

/**
 * Só o autor edita. Devolve o post atualizado, null se não existe, "forbidden"
 * se não é dele. Texto ou link inválido sai como Error (mesmas mensagens do
 * createPost). O patch pode mexer só em allowQuote (o menu "não aceitar
 * citação"), só no texto, ou nos dois.
 */
export async function updatePost(
  postId: number,
  member: { id: number },
  patch: PostPatch,
): Promise<Post | null | "forbidden"> {
  const cur = await db
    .prepare(`SELECT memberId, link, "allowQuote" FROM posts WHERE id = ?`)
    .get<{ memberId: number; link: string | null; allowQuote: number }>(postId);
  if (!cur) return null;
  if (Number(cur.memberId) !== member.id) return "forbidden";
  const touchesText = patch.body !== undefined;
  const touchesQuote = patch.allowQuote !== undefined;
  if (!touchesText && !touchesQuote) throw new Error("Post vazio");
  if (touchesQuote) {
    if (typeof patch.allowQuote !== "boolean") throw new Error("allowQuote inválido");
    await db.prepare(`UPDATE posts SET "allowQuote" = ? WHERE id = ?`).run(patch.allowQuote ? 1 : 0, postId);
  }
  if (touchesText) {
    const v = validatePostInput(patch.body, patch.link === undefined ? cur.link : patch.link);
    await db
      .prepare(`UPDATE posts SET body = ?, link = ?, "editedAt" = datetime('now') WHERE id = ?`)
      .run(v.body, v.link, postId);
    // editar reescreve menções e tags; quem já estava mencionado não é avisado de novo
    await syncMentionsAndTags(postId, null, v.body, await actorOf(member.id));
  }
  return (await hydratePosts([postId], member.id))[0] ?? null;
}

// ---------- repost e citação (migration 049) ----------

export type ShareTarget =
  | { ok: true; post: Post }
  | { ok: false; status: 400 | 403 | 404; error: string };

const NOT_FOUND = "Not found";
const SHARE_OFF = "Este post não está disponível pra compartilhar.";

/**
 * O post que dá pra repostar ou citar, ou o motivo de não dar. Regra única
 * das duas rotas:
 * - repost aponta pro original: compartilhar um repost compartilha o original;
 * - bloqueio (dois sentidos) responde 404, como se o post não existisse;
 * - espaço fora do ar (comunidade escondida, edição inativa) e recado no
 *   perfil respondem 400 com a mensagem;
 * - o resto é o post hidratado, com repostOf/quoteOf já resolvidos.
 */
export async function shareTarget(postId: number, meId: number, depth = 0): Promise<ShareTarget> {
  if (!Number.isSafeInteger(postId) || postId <= 0) return { ok: false, status: 404, error: NOT_FOUND };
  const row = await db
    .prepare(
      `SELECT p.memberId, p.profileId, p."repostOfId",
              COALESCE(co.hidden, 0) AS hidden, COALESCE(hh.active, 1) AS "editionActive",
              COALESCE(hc.hidden, 0) AS "editionHidden"
       FROM posts p
       LEFT JOIN communities co ON co.id = p.communityId
       LEFT JOIN hackathons hh ON hh.id = p.hackathonId
       LEFT JOIN communities hc ON hc.id = hh.communityId
       WHERE p.id = ?`,
    )
    .get<{
      memberId: number;
      profileId: number | null;
      repostOfId: number | null;
      hidden: number;
      editionActive: number;
      editionHidden: number;
    }>(postId);
  if (!row) return { ok: false, status: 404, error: NOT_FOUND };
  if (row.repostOfId !== null && depth < 3) return shareTarget(Number(row.repostOfId), meId, depth + 1);
  if (await isBlockedEither(meId, Number(row.memberId))) return { ok: false, status: 404, error: NOT_FOUND };
  if (row.profileId !== null && (await isBlockedEither(meId, Number(row.profileId)))) {
    return { ok: false, status: 404, error: NOT_FOUND };
  }
  if (Number(row.hidden) === 1 || Number(row.editionActive) === 0 || Number(row.editionHidden) === 1) {
    return { ok: false, status: 400, error: SHARE_OFF };
  }
  // recado no perfil é conversa de quem recebeu, não conteúdo pra espalhar
  if (row.profileId !== null) return { ok: false, status: 400, error: "Recado não pode ser compartilhado." };
  const post = await getPost(postId, meId);
  if (!post) return { ok: false, status: 404, error: NOT_FOUND };
  return { ok: true, post };
}

/** quantos reposts o post tem (o contador do card) */
export async function shareCount(postId: number): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM posts WHERE "repostOfId" = ?`)
    .get<{ n: number }>(postId);
  return Number(row?.n ?? 0);
}

/**
 * Reposta o post (idempotente: um repost por pessoa por post, o botão é
 * toggle). O repost não tem escopo próprio: ele aparece na timeline de quem
 * segue quem repostou, com o chip do espaço do original.
 */
export async function repostPost(
  post: Post,
  member: { id: number },
): Promise<{ post: Post; created: boolean; shareCount: number }> {
  const mine = async () =>
    db
      .prepare(`SELECT id FROM posts WHERE memberId = ? AND "repostOfId" = ?`)
      .get<{ id: number }>(member.id, post.id);
  const existing = await mine();
  if (existing) {
    return {
      post: (await hydratePosts([Number(existing.id)], member.id))[0],
      created: false,
      shareCount: await shareCount(post.id),
    };
  }
  let created: Post;
  try {
    created = await createPost(member.id, "", null, null, null, null, null, { repostOfId: post.id });
  } catch (e) {
    // dois cliques ao mesmo tempo caem no índice único: devolve o que ficou
    const again = await mine();
    if (!again) throw e;
    return {
      post: (await hydratePosts([Number(again.id)], member.id))[0],
      created: false,
      shareCount: await shareCount(post.id),
    };
  }
  return { post: created, created: true, shareCount: await shareCount(post.id) };
}

/** tira o repost que eu fiz deste post (o toggle do card) */
export async function unrepostPost(postId: number, memberId: number): Promise<{ removed: boolean; shareCount: number }> {
  const r = await db
    .prepare(`DELETE FROM posts WHERE memberId = ? AND "repostOfId" = ?`)
    .run(memberId, postId);
  return { removed: r.changes > 0, shareCount: await shareCount(postId) };
}

type ModeratableActor = { id: number; role: string } | null;

/**
 * Regra única de quem apaga post (e comentário dele): autor, admin global,
 * dono do perfil onde o recado está, dono ou organizador da comunidade do
 * post, organizador ou staff da edição.
 */
export async function canModeratePost(
  member: ModeratableActor,
  post: { memberId: number; communityId: number | null; hackathonId: string | null; profileId?: number | null },
): Promise<boolean> {
  if (!member) return false;
  if (member.role === "admin" || member.id === Number(post.memberId)) return true;
  if (post.profileId != null && member.id === Number(post.profileId)) return true;
  if (post.communityId !== null && (await canManageCommunity(member, Number(post.communityId)))) return true;
  if (post.hackathonId !== null && (await hasEditionRole(member, post.hackathonId, "staff"))) return true;
  return false;
}

async function postSpace(postId: number) {
  return db
    .prepare("SELECT memberId, communityId, hackathonId, profileId FROM posts WHERE id = ?")
    .get<{ memberId: number; communityId: number | null; hackathonId: string | null; profileId: number | null }>(postId);
}

// reações e comentários saem junto por cascade (migration 034)
export async function deletePost(postId: number, requester: Member | { id: number; role: string }): Promise<boolean> {
  const post = await postSpace(postId);
  if (!post || !(await canModeratePost(requester, post))) return false;
  await db.prepare("DELETE FROM posts WHERE id = ?").run(postId);
  return true;
}

/** autor do comentário ou quem modera o post (canModeratePost); respostas vão por cascade */
export async function deleteComment(commentId: number, requester: Member | { id: number; role: string }): Promise<boolean> {
  const comment = await db
    .prepare("SELECT memberId, postId FROM post_comments WHERE id = ?")
    .get<{ memberId: number; postId: number }>(commentId);
  if (!comment) return false;
  if (Number(comment.memberId) !== requester.id) {
    const post = await postSpace(Number(comment.postId));
    if (!post || !(await canModeratePost(requester, post))) return false;
  }
  await db.prepare("DELETE FROM post_comments WHERE id = ?").run(commentId);
  return true;
}

/**
 * Troca a reação (uma por pessoa por post). null tira. Devolve a reação que
 * ficou e se mudou algo.
 */
export async function setReaction(
  postId: number,
  memberId: number,
  kind: ReactionKind | null,
): Promise<{ kind: ReactionKind | null; changed: boolean }> {
  if (kind === null) {
    const r = await db.prepare("DELETE FROM likes WHERE postId = ? AND memberId = ?").run(postId, memberId);
    return { kind: null, changed: r.changes > 0 };
  }
  if (!isReactionKind(kind)) throw new Error("Reação inválida");
  const r = await db
    .prepare(
      `INSERT INTO likes (postId, memberId, kind) VALUES (?, ?, ?)
       ON CONFLICT (postId, memberId) DO UPDATE SET kind = EXCLUDED.kind WHERE likes.kind <> EXCLUDED.kind`,
    )
    .run(postId, memberId, kind);
  return { kind, changed: r.changes > 0 };
}

/** like antigo: alterna 'curti'. true = ficou com reação */
export async function toggleLike(postId: number, memberId: number): Promise<boolean> {
  const existing = await db.prepare("SELECT 1 FROM likes WHERE postId = ? AND memberId = ?").get(postId, memberId);
  if (existing) {
    await setReaction(postId, memberId, null);
    return false;
  }
  await setReaction(postId, memberId, "curti");
  return true;
}

/** contagem por tipo de um post (resposta da rota de reação) */
export async function reactionCounts(postId: number): Promise<Record<ReactionKind, number>> {
  const rows = await db
    .prepare("SELECT kind, COUNT(*) AS n FROM likes WHERE postId = ? GROUP BY kind")
    .all<{ kind: string; n: number }>(postId);
  const out = emptyReactions();
  for (const r of rows) if (isReactionKind(r.kind)) out[r.kind] = Number(r.n);
  return out;
}
