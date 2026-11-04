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
};

/**
 * Onde o post mora. `global` é o feed agregado (tudo que é visível:
 * global, edições e comunidades); `member` são os posts que a pessoa
 * escreveu. `solto` é só o post sem edição nem comunidade.
 */
export type PostScope =
  | { kind: "global" }
  | { kind: "hackathon"; id: string }
  | { kind: "community"; id: number }
  | { kind: "member"; id: number };

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
    case "solto":
      where.push("p.hackathonId IS NULL AND p.communityId IS NULL");
      break;
  }
  if (!opts.includeHidden) where.push(SPACE_UP_SQL);
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

type PostRow = Omit<Post, "reactions" | "myReaction" | "likeCount" | "likedByMe" | "linkCard" | "canModerate"> & {
  myReaction: string | null;
  mentionedUsernames: string[] | string | null;
};

const SELECT = `SELECT p.id, p.memberId, p.body, p.link, p.createdAt, p.editedAt, p.hackathonId,
       h.name AS hackathonName, p.communityId, co.name AS "communityName", co.slug AS "communitySlug",
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

export async function hydratePosts(ids: number[], meId: number | null): Promise<Post[]> {
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
          (row.communityId !== null && spaces.communities.has(Number(row.communityId))) ||
          (row.hackathonId !== null && spaces.editions.has(row.hackathonId)));
      byId.set(Number(row.id), {
        ...row,
        id: Number(row.id),
        memberId: Number(row.memberId),
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
  return clean.map((id) => byId.get(id)).filter((p): p is Post => !!p);
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
      `SELECT p.memberId, p.hackathonId, COALESCE(co.hidden, 0) AS hidden,
              COALESCE(hh.active, 1) AS "editionActive", COALESCE(hc.hidden, 0) AS "editionHidden"
       FROM posts p
       LEFT JOIN communities co ON co.id = p.communityId
       LEFT JOIN hackathons hh ON hh.id = p.hackathonId
       LEFT JOIN communities hc ON hc.id = hh.communityId
       WHERE p.id = ?`,
    )
    .get<{ memberId: number; hackathonId: string | null; hidden: number; editionActive: number; editionHidden: number }>(id);
  if (!row) return null;
  const adminOnly = Number(row.hidden) === 1 || Number(row.editionActive) === 0;
  if (adminOnly || Number(row.editionHidden) === 1) {
    const viewer = await viewerOf(meId);
    if (!viewer) return null;
    if (adminOnly && viewer.role !== "admin") return null;
    if (!adminOnly && !(await canManageEdition(viewer, row.hackathonId!))) return null;
  }
  if (meId && (await isBlockedEither(meId, Number(row.memberId)))) return null;
  return (await hydratePosts([id], meId))[0] ?? null;
}

/** texto e link de post: as mesmas regras pra criar e editar */
export function validatePostInput(body: unknown, link: unknown): { body: string; link: string | null } {
  const trimmed = typeof body === "string" ? body.trim().slice(0, POST_LIMITS.body) : "";
  if (!trimmed) throw new Error("Post vazio");
  const url = typeof link === "string" ? link.trim() || null : null;
  if (url) {
    // externo com http(s) ou caminho do próprio HackaHub ("/p/12")
    const external = /^https?:\/\/[^\s]+$/i.test(url);
    const internal = /^\/(?![/\\])[^\s]*$/.test(url);
    if ((!external && !internal) || url.length > POST_LIMITS.link) throw new Error("Link inválido");
  }
  return { body: trimmed, link: url };
}

export async function createPost(
  memberId: number,
  body: string,
  link?: string | null,
  hackathonId?: string | null,
  communityId?: number | null,
): Promise<Post> {
  const v = validatePostInput(body, link);
  // escopo é só persistido aqui — edição existe/ativa e inscrição do membro
  // são validados na rota, que tem os códigos HTTP (404/400/403)
  const row = await db
    .prepare("INSERT INTO posts (memberId, body, link, hackathonId, communityId) VALUES (?, ?, ?, ?, ?) RETURNING id")
    .get<{ id: number }>(memberId, v.body, v.link, hackathonId?.trim() || null, communityId ?? null);
  await syncMentionsAndTags(row!.id, null, v.body, await actorOf(memberId));
  return (await hydratePosts([row!.id], memberId))[0];
}

/** @ e id de quem escreveu, pro aviso de menção e pro filtro de bloqueio */
async function actorOf(memberId: number): Promise<{ id: number; username: string }> {
  const row = await db.prepare("SELECT username FROM members WHERE id = ?").get<{ username: string }>(memberId);
  return { id: memberId, username: row?.username ?? "" };
}

/**
 * Só o autor edita. Devolve o post atualizado, null se não existe, "forbidden"
 * se não é dele. Texto ou link inválido sai como Error (mesmas mensagens do
 * createPost).
 */
export async function updatePost(
  postId: number,
  member: { id: number },
  body: unknown,
  link: unknown,
): Promise<Post | null | "forbidden"> {
  const cur = await db.prepare("SELECT memberId FROM posts WHERE id = ?").get<{ memberId: number }>(postId);
  if (!cur) return null;
  if (Number(cur.memberId) !== member.id) return "forbidden";
  const v = validatePostInput(body, link);
  await db
    .prepare(`UPDATE posts SET body = ?, link = ?, "editedAt" = datetime('now') WHERE id = ?`)
    .run(v.body, v.link, postId);
  // editar reescreve menções e tags; quem já estava mencionado não é avisado de novo
  await syncMentionsAndTags(postId, null, v.body, await actorOf(member.id));
  return (await hydratePosts([postId], member.id))[0] ?? null;
}

type ModeratableActor = { id: number; role: string } | null;

/**
 * Regra única de quem apaga post (e comentário dele): autor, admin global,
 * dono ou organizador da comunidade do post, organizador ou staff da edição.
 */
export async function canModeratePost(
  member: ModeratableActor,
  post: { memberId: number; communityId: number | null; hackathonId: string | null },
): Promise<boolean> {
  if (!member) return false;
  if (member.role === "admin" || member.id === Number(post.memberId)) return true;
  if (post.communityId !== null && (await canManageCommunity(member, Number(post.communityId)))) return true;
  if (post.hackathonId !== null && (await hasEditionRole(member, post.hackathonId, "staff"))) return true;
  return false;
}

async function postSpace(postId: number) {
  return db
    .prepare("SELECT memberId, communityId, hackathonId FROM posts WHERE id = ?")
    .get<{ memberId: number; communityId: number | null; hackathonId: string | null }>(postId);
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
