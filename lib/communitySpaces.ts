import db from "@/lib/db";
import { hiddenAuthorSql } from "@/lib/blocks";
import { canManageCommunity, getMembership, slugify, type CommunityRole } from "@/lib/communities";
import { shareOriginUpSql, spaceUpSql } from "@/lib/posts";

// Espaços da comunidade (spec 046, onda 6, migration 057): o mural se
// divide em espaços estilo Circle — geral, ajuda, vagas e mostra nascem com
// a comunidade e dono/organizador cria mais, renomeia, ordena e arquiva em
// /comunidade/[slug]/espacos. Quem posta escolhe o espaço no PostComposer;
// post de comunidade sem spaceId cai no geral. Cada espaço tem mural
// próprio em /comunidade/[slug]/s/[space] e a pessoa entra só no que
// interessa.
//
// Regras:
// - até 8 espaços ativos por comunidade; arquivar esconde do seletor e
//   mantém os posts (eles ficam no spaceId);
// - o geral é o porto seguro do mural (post sem espaço cai nele): não dá
//   pra arquivar;
// - postPolicy organizacao = só dono, organizador e admin global postam;
// - quem só segue a comunidade (community_follows) continua sem postar;
// - renomear muda o nome na tela; o slug (e a URL /s/[space]) é estável.

import { SPACE_LIMITS, SPACE_SLUG_RE, DEFAULT_SPACE, type SpacePolicy, type CommunitySpace } from "@/lib/spaceConsts";

export {
  SPACE_LIMITS,
  SPACE_SLUG_RE,
  DEFAULT_SPACE,
  SPACE_POLICIES,
  SPACE_POLICY_LABEL,
} from "@/lib/spaceConsts";
export type { SpacePolicy, CommunitySpace } from "@/lib/spaceConsts";

export class SpaceError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** linha da tabela → tipo público */
function toSpace(r: Record<string, unknown>): CommunitySpace {
  return {
    id: Number(r.id),
    communityId: Number(r.communityId),
    slug: String(r.slug),
    name: String(r.name),
    description: (r.description as string | null) ?? null,
    postPolicy: r.postPolicy === "organizacao" ? "organizacao" : "membros",
    position: Number(r.position),
    archivedAt: (r.archivedAt as string | null) ?? null,
    createdAt: String(r.createdAt),
  };
}

const COLS = `id, "communityId", "slug", "name", "description", "postPolicy", "position", "archivedAt", "createdAt"`;

/**
 * Espaços da comunidade: ativos primeiro, na ordem da barra; arquivados no
 * fim quando includeArchived. O seletor e a barra usam os ativos; a página
 * de gerir usa todos.
 */
export async function listSpaces(communityId: number, opts: { includeArchived?: boolean } = {}): Promise<CommunitySpace[]> {
  const rows = await db
    .prepare(
      `SELECT ${COLS} FROM community_spaces WHERE "communityId" = ? ${opts.includeArchived ? "" : `AND "archivedAt" IS NULL`}
       ORDER BY ("archivedAt" IS NOT NULL), "position", "id"`,
    )
    .all(communityId);
  return rows.map(toSpace);
}

/** espaço pelo slug na barra/endereço — vem arquivado também; quem chama decide */
export async function getSpaceBySlug(communityId: number, slug: string): Promise<CommunitySpace | null> {
  const row = await db
    .prepare(`SELECT ${COLS} FROM community_spaces WHERE "communityId" = ? AND "slug" = ?`)
    .get(communityId, slug);
  return row ? toSpace(row) : null;
}

export async function getSpaceById(id: number): Promise<CommunitySpace | null> {
  const row = await db.prepare(`SELECT ${COLS} FROM community_spaces WHERE "id" = ?`).get(id);
  return row ? toSpace(row) : null;
}

/**
 * O espaço padrão (geral): todo post de comunidade sem espaço cai nele.
 * Comunidade criada depois da 057 ganha os 4 pelo trigger; as antigas pelo
 * backfill. Se por alguma falha o geral não existir, ele nasce aqui.
 */
export async function defaultSpace(communityId: number): Promise<CommunitySpace> {
  const existing = await getSpaceBySlug(communityId, DEFAULT_SPACE);
  if (existing) return existing;
  await db
    .prepare(
      `INSERT INTO community_spaces ("communityId", "slug", "name", "description", "position")
       VALUES (?, ?, ?, ?, 0)
       ON CONFLICT ("communityId", "slug") DO NOTHING`,
    )
    .run(communityId, DEFAULT_SPACE, DEFAULT_SPACE, "o que vale pra comunidade inteira");
  return (await getSpaceBySlug(communityId, DEFAULT_SPACE))!;
}

// ---------- escrever (dono, organizador, admin) ----------

export type SpaceInput = { name?: unknown; description?: unknown; postPolicy?: unknown };

/** nome → slug estável do endereço /s/[space] (a-z0-9-, 2 a 30) */
export function spaceSlug(name: string): string {
  return slugify(name).slice(0, 30).replace(/-+$/g, "");
}

function cleanName(v: unknown): string {
  const name = typeof v === "string" ? v.trim() : "";
  if (!name) throw new SpaceError("O espaço precisa de um nome.", 400);
  if (name.length > SPACE_LIMITS.name) throw new SpaceError(`Nome até ${SPACE_LIMITS.name} caracteres.`, 400);
  return name;
}

function cleanDescription(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const d = String(v).trim();
  if (d.length > SPACE_LIMITS.description) throw new SpaceError(`Descrição até ${SPACE_LIMITS.description} caracteres.`, 400);
  return d || null;
}

function cleanPolicy(v: unknown): SpacePolicy {
  if (v === undefined || v === null) return "membros";
  if (v === "membros" || v === "organizacao") return v;
  throw new SpaceError("Política de post inválida.", 400);
}

async function activeCount(communityId: number, exceptId?: number): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*)::int AS n FROM community_spaces WHERE "communityId" = ? AND "archivedAt" IS NULL AND id <> ?`,
    )
    .get<{ n: number }>(communityId, exceptId ?? -1);
  return Number(row?.n ?? 0);
}

/** cria o espaço no fim da barra. Nono ativo e slug repetido dão 400. */
export async function createSpace(communityId: number, input: SpaceInput): Promise<CommunitySpace> {
  const name = cleanName(input.name);
  const description = cleanDescription(input.description);
  const postPolicy = cleanPolicy(input.postPolicy);
  if ((await activeCount(communityId)) >= SPACE_LIMITS.active) {
    throw new SpaceError(`Cada comunidade tem até ${SPACE_LIMITS.active} espaços ativos. Arquive um pra criar outro.`, 400);
  }
  const slug = spaceSlug(name);
  if (!SPACE_SLUG_RE.test(slug)) throw new SpaceError("Esse nome não vira um endereço de espaço.", 400);
  if (await getSpaceBySlug(communityId, slug)) throw new SpaceError("Já existe um espaço com esse nome.", 400);
  const row = await db
    .prepare(
      `INSERT INTO community_spaces ("communityId", "slug", "name", "description", "postPolicy", "position")
       VALUES (@cid, @slug, @name, @description, @policy,
         (SELECT COALESCE(MAX("position"), -1) + 1 FROM community_spaces WHERE "communityId" = @cid))
       RETURNING ${COLS}`,
    )
    .get({ cid: communityId, slug, name, description, policy: postPolicy });
  return toSpace(row!);
}

export type SpacePatch = { name?: unknown; description?: unknown; postPolicy?: unknown; archived?: unknown };

/**
 * Renomeia, muda descrição/política e arquiva/desarquiva. O geral não é
 * arquivável: é pra ele que cai post sem espaço. Desarquivar respeita o
 * teto de 8 ativos.
 */
export async function updateSpace(communityId: number, spaceId: number, patch: SpacePatch): Promise<CommunitySpace> {
  const cur = await getSpaceById(spaceId);
  if (!cur || cur.communityId !== communityId) throw new SpaceError("Espaço não encontrado.", 404);
  const name = patch.name === undefined ? cur.name : cleanName(patch.name);
  const description = patch.description === undefined ? cur.description : cleanDescription(patch.description);
  const postPolicy = patch.postPolicy === undefined ? cur.postPolicy : cleanPolicy(patch.postPolicy);
  let archivedAt = cur.archivedAt;
  if (patch.archived === true && archivedAt === null) {
    if (cur.slug === DEFAULT_SPACE) throw new SpaceError(`O #${DEFAULT_SPACE} recebe todo post sem espaço: não dá pra arquivar.`, 400);
    archivedAt = "now";
  } else if (patch.archived === false && archivedAt !== null) {
    if ((await activeCount(communityId, cur.id)) >= SPACE_LIMITS.active) {
      throw new SpaceError(`Cada comunidade tem até ${SPACE_LIMITS.active} espaços ativos. Arquive um pra trazer outro de volta.`, 400);
    }
    archivedAt = null;
  } else if (patch.archived !== undefined && patch.archived !== true && patch.archived !== false) {
    throw new SpaceError("archived inválido.", 400);
  }
  const archivedSql = archivedAt === "now" ? "sqlite_now()" : "@archived";
  const row = await db
    .prepare(
      `UPDATE community_spaces SET "name" = @name, "description" = @description, "postPolicy" = @policy,
         "archivedAt" = ${archivedSql}
       WHERE id = @id RETURNING ${COLS}`,
    )
    .get({ id: cur.id, name, description, policy: postPolicy, archived: archivedAt === "now" ? null : archivedAt });
  return toSpace(row!);
}

/** nova ordem da barra: todos os espaços ativos, uma vez cada (as setinhas) */
export async function reorderSpaces(communityId: number, ids: number[]): Promise<CommunitySpace[]> {
  const active = (await listSpaces(communityId)).map((s) => s.id);
  const want = new Set(ids);
  if (ids.length !== active.length || want.size !== ids.length || active.some((id) => !want.has(id))) {
    throw new SpaceError("A ordem precisa ter todos os espaços ativos da comunidade, uma vez cada.", 400);
  }
  await db.transaction(async () => {
    for (const [i, id] of ids.entries()) {
      await db.prepare(`UPDATE community_spaces SET "position" = ? WHERE id = ? AND "communityId" = ?`).run(i + 1, id, communityId);
    }
  })();
  return listSpaces(communityId);
}

// ---------- ler e postar ----------

/** quem pode postar no espaço: membro; política organizacao pede dono/organizador/admin */
export async function canPostInSpace(
  member: { id: number; role: string },
  space: CommunitySpace,
): Promise<boolean> {
  if (!(await getMembership(space.communityId, member.id))) return false;
  if (space.postPolicy === "organizacao") return canManageCommunity(member, space.communityId);
  return true;
}

/** versão síncrona pra página: já tem role e canManage em mãos */
export function spacePostable(space: Pick<CommunitySpace, "postPolicy">, role: CommunityRole | null, canManage: boolean): boolean {
  return role !== null && (space.postPolicy === "membros" || canManage);
}

/**
 * Ids do mural do espaço, mais novo primeiro (mesma regra de listPostIds:
 * espaço fora do ar e repost quebrado ficam de fora, bloqueio nos dois
 * sentidos também). No geral entram também os posts com spaceId nulo: é o
 * porto seguro do mural.
 */
export async function postIdsBySpace(
  space: Pick<CommunitySpace, "id" | "slug" | "communityId">,
  meId: number | null,
  antes: number | null = null,
  limit = 30,
  /** só pra rota que já conferiu que quem lê pode ver o espaço fora do ar */
  opts: { includeHidden?: boolean } = {},
): Promise<number[]> {
  const size = Math.max(1, Math.min(Math.floor(limit) || 30, 100));
  const params: Record<string, unknown> = { me: meId ?? -1, sid: space.id, cid: space.communityId, limit: size };
  const where = [
    `p."communityId" = @cid`,
    space.slug === DEFAULT_SPACE ? `(p."spaceId" = @sid OR p."spaceId" IS NULL)` : `p."spaceId" = @sid`,
    `p."profileId" IS NULL`,
  ];
  if (!opts.includeHidden) where.push(spaceUpSql("p"), shareOriginUpSql("p"));
  if (meId) where.push(hiddenAuthorSql("p.memberId"));
  if (antes) {
    where.push(`p.id < @antes`);
    params.antes = antes;
  }
  const rows = await db
    .prepare(`SELECT p.id FROM posts p WHERE ${where.join(" AND ")} ORDER BY p.id DESC LIMIT @limit`)
    .all<{ id: number }>(params);
  return rows.map((r) => Number(r.id));
}

// ---------- tela ----------

/** frase do mural vazio por espaço (a do #ajuda é a da spec) */
const EMPTY_HINT: Record<string, string> = {
  geral: "Conte o que a comunidade está construindo.",
  ajuda: "Pergunte o que está travando você.",
  vagas: "Poste a primeira vaga.",
  mostra: "Mostre o que você fez.",
};

export function spaceEmptyHint(space: Pick<CommunitySpace, "slug" | "description">): string {
  return `Nada em #${space.slug} ainda. ${EMPTY_HINT[space.slug] ?? space.description ?? "Seja a primeira pessoa a postar."}`;
}
