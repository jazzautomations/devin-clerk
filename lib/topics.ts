import db from "@/lib/db";
import { hiddenAuthorSql, hiddenIdsFor, isBlockedEither } from "@/lib/blocks";
import { getMembership, type CommunityRole } from "@/lib/communities";
import { canNetwork } from "@/lib/network";
import { notify } from "@/lib/notifications";
import { toLikePattern } from "@/lib/search";
import { HOT_POOL, parseDbTime, rankHot, TOPIC_KINDS, TOPIC_LIMITS, topicHref, type ReplySort, type TopicKind, type TopicSort, type TopPeriod } from "@/lib/topicsShared";

export * from "@/lib/topicsShared";

// Tópicos da comunidade (migration 058, spec 046 onda 1). Fórum por
// comunidade: tópico com título e corpo, respostas em árvore até 6 níveis,
// voto pra cima e pra baixo, ordenação, fixar, trancar e enquete.
//
// Quem faz o quê:
// - lê: quem tem conta (comunidade escondida só o admin global);
// - cria, responde, vota e vota em enquete: membro da comunidade
//   (community_members, qualquer papel). Quem só segue lê;
// - fixa (até 3), tranca, remove e edita flair: dono, organizador ou admin
//   global (canModerate);
// - edita e apaga o próprio: o autor. Apagar com resposta de outra pessoa
//   deixa "[apagado]" no lugar e a árvore continua.
//
// Voto não dá XP nem rep (regra do plano: nada por like). O score do alvo é
// a soma dos votos, recalculada na transação do voto.
//
// Contratos pras próximas ondas: listTopics, hotTopics, countTopics,
// getTopic, listReplies, topicHref e hotScore/rankHot.


export class TopicError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export type Actor = { id: number; role: string };

// ---------- leitura ----------

export type TopicAuthor = { id: number; username: string; name: string | null; avatarUrl: string | null };

export type TopicSummary = {
  id: number;
  communityId: number;
  title: string;
  flair: string | null;
  kind: TopicKind;
  /** null quando apagado ou conta excluída */
  author: TopicAuthor | null;
  score: number;
  myVote: -1 | 0 | 1;
  replyCount: number;
  pinned: boolean;
  locked: boolean;
  removed: boolean;
  deleted: boolean;
  /** pergunta com resposta aceita */
  resolved: boolean;
  lastActivityAt: string;
  createdAt: string;
};

type SummaryRow = {
  id: number;
  communityId: number;
  title: string;
  flair: string | null;
  kind: TopicKind;
  memberId: number | null;
  username: string | null;
  name: string | null;
  avatarUrl: string | null;
  clerkId: string | null;
  score: number;
  myVote: number;
  replyCount: number;
  pinnedAt: string | null;
  lockedAt: string | null;
  removedAt: string | null;
  deletedAt: string | null;
  acceptedReplyId: number | null;
  lastActivityAt: string;
  createdAt: string;
};

const SUMMARY = `SELECT t.id, t.communityId, t.title, t.flair, t.kind, t.memberId, m.username, m.name, m.avatarUrl, m.clerkId,
    t.score, COALESCE(v.value, 0) AS myVote, t.replyCount, t.pinnedAt, t.lockedAt, t.removedAt, t.deletedAt,
    t.acceptedReplyId, t.lastActivityAt, t.createdAt
  FROM community_topics t
  LEFT JOIN members m ON m.id = t.memberId
  LEFT JOIN topic_votes v ON v.targetType = 'topic' AND v.targetId = t.id AND v.memberId = @me`;

function authorOf(r: { memberId: number | null; username: string | null; name: string | null; avatarUrl: string | null; clerkId: string | null }): TopicAuthor | null {
  if (r.memberId === null || !r.username || (r.clerkId ?? "").startsWith("deleted:")) return null;
  return { id: Number(r.memberId), username: r.username, name: r.name, avatarUrl: r.avatarUrl };
}

function toSummary(r: SummaryRow): TopicSummary {
  const deleted = r.deletedAt !== null;
  const removed = r.removedAt !== null;
  return {
    id: Number(r.id),
    communityId: Number(r.communityId),
    title: r.title,
    flair: r.flair,
    kind: r.kind,
    author: deleted ? null : authorOf(r),
    score: Number(r.score),
    myVote: (Math.sign(Number(r.myVote)) as -1 | 0 | 1) || 0,
    replyCount: Number(r.replyCount),
    pinned: r.pinnedAt !== null,
    locked: r.lockedAt !== null,
    removed,
    deleted,
    resolved: r.acceptedReplyId !== null,
    lastActivityAt: r.lastActivityAt,
    createdAt: r.createdAt,
  };
}

export type ListTopicsOpts = {
  sort?: TopicSort;
  period?: TopPeriod;
  flair?: string | null;
  q?: string | null;
  limit?: number;
  /** moderador vê os removidos (com selo) */
  includeRemoved?: boolean;
  now?: Date;
};

/**
 * Lista da comunidade. Fixados vêm à parte (até 3, sempre no topo, filtrados
 * só por flair e busca); `topics` é o resto na ordem pedida. Autor bloqueado
 * (dois sentidos) ou silenciado por quem lê some.
 */
export async function listTopics(
  communityId: number,
  viewerId: number | null,
  opts: ListTopicsOpts = {},
): Promise<{ pinned: TopicSummary[]; topics: TopicSummary[] }> {
  const sort = opts.sort ?? "em-alta";
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
  const bag: Record<string, unknown> = { c: communityId, me: viewerId ?? -1 };
  const base = ["t.communityId = @c", hiddenAuthorSql("t.memberId")];
  if (!opts.includeRemoved) base.push("t.removedAt IS NULL");
  const flair = cleanFlair(opts.flair);
  if (flair) {
    base.push("lower(t.flair) = lower(@flair)");
    bag.flair = flair;
  }
  const like = toLikePattern((opts.q ?? "").slice(0, TOPIC_LIMITS.q));
  if (like) {
    base.push("t.title LIKE @q");
    bag.q = like;
  }

  const pinned = (
    await db
      .prepare(`${SUMMARY} WHERE ${[...base, "t.pinnedAt IS NOT NULL"].join(" AND ")} ORDER BY to_ts(t.pinnedAt) DESC, t.id DESC LIMIT ${TOPIC_LIMITS.pinned}`)
      .all<SummaryRow>(bag)
  ).map(toSummary);

  const where = [...base, "t.pinnedAt IS NULL"];
  let order = "to_ts(t.createdAt) DESC, t.id DESC";
  let take = limit;
  if (sort === "top") {
    const period = opts.period ?? "semana";
    if (period !== "sempre") {
      where.push(`to_ts(t.createdAt) >= now() - interval '${period === "semana" ? "7 days" : "30 days"}'`);
    }
    order = "t.score DESC, to_ts(t.createdAt) DESC, t.id DESC";
  } else if (sort === "sem-resposta") {
    // pergunta só sai daqui quando o autor aceita uma resposta
    where.push("t.acceptedReplyId IS NULL AND (t.replyCount = 0 OR t.kind = 'pergunta')", "t.lockedAt IS NULL", "t.deletedAt IS NULL");
  } else if (sort === "em-alta") {
    take = HOT_POOL;
  }
  const rows = (await db.prepare(`${SUMMARY} WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ${take}`).all<SummaryRow>(bag)).map(toSummary);
  const topics = sort === "em-alta" ? rankHot(rows, opts.now ?? new Date()).slice(0, limit) : rows;
  return { pinned, topics };
}

/** bloco "Tópicos em alta" da página da comunidade (fixados entram no ranking como qualquer um) */
export async function hotTopics(communityId: number, viewerId: number | null, n = 5, now = new Date()): Promise<TopicSummary[]> {
  const rows = (
    await db
      .prepare(
        `${SUMMARY} WHERE t.communityId = @c AND t.removedAt IS NULL AND ${hiddenAuthorSql("t.memberId")}
         ORDER BY to_ts(t.createdAt) DESC, t.id DESC LIMIT ${HOT_POOL}`,
      )
      .all<SummaryRow>({ c: communityId, me: viewerId ?? -1 })
  ).map(toSummary);
  return rankHot(rows, now).slice(0, n);
}

/** tópicos no ar (o cartão público mostra "N tópicos") */
export async function countTopics(communityId: number): Promise<number> {
  const r = await db
    .prepare("SELECT COUNT(*)::int AS n FROM community_topics WHERE communityId = ? AND removedAt IS NULL")
    .get<{ n: number }>(communityId);
  return Number(r?.n ?? 0);
}

/** flairs em uso (filtro da lista), mais usados primeiro */
export async function listFlairs(communityId: number, limit = 12): Promise<string[]> {
  const rows = await db
    .prepare(
      `SELECT min(flair) AS flair, COUNT(*)::int AS n FROM community_topics
       WHERE communityId = ? AND flair IS NOT NULL AND removedAt IS NULL
       GROUP BY lower(flair) ORDER BY n DESC, min(flair) ASC LIMIT ?`,
    )
    .all<{ flair: string }>(communityId, limit);
  return rows.map((r) => r.flair);
}

export type PollOption = { id: number; label: string; votes: number };
export type TopicPoll = { options: PollOption[]; total: number; myOptionId: number | null; closed: boolean };

export type TopicDetail = TopicSummary & {
  body: string;
  editedAt: string | null;
  acceptedReplyId: number | null;
  communitySlug: string;
  communityName: string;
  poll: TopicPoll | null;
  /** quem lê é o autor */
  mine: boolean;
  /** quem lê é membro da comunidade (responde e vota) */
  isMember: boolean;
  /** dono, organizador ou admin global */
  canModerate: boolean;
};

type Access = { role: CommunityRole | null; isMember: boolean; canModerate: boolean };

async function accessFor(communityId: number, viewer: Actor | null): Promise<Access> {
  if (!viewer) return { role: null, isMember: false, canModerate: false };
  const role = await getMembership(communityId, viewer.id);
  return {
    role,
    isMember: role !== null,
    canModerate: viewer.role === "admin" || role === "dono" || role === "organizador",
  };
}

type TopicRow = SummaryRow & { body: string; editedAt: string | null; slug: string; communityName: string; hidden: number };

async function topicRow(id: number, viewerId: number | null): Promise<TopicRow | null> {
  const row = await db
    .prepare(
      `SELECT x.*, c.slug, c.name AS communityName, c.hidden FROM (
         ${SUMMARY.replace("SELECT ", "SELECT t.body, t.editedAt, ")} WHERE t.id = @id
       ) x JOIN communities c ON c.id = x.communityId`,
    )
    .get<TopicRow>({ id, me: viewerId ?? -1 });
  return row ?? null;
}

async function pollFor(topicId: number, viewerId: number | null, closed: boolean): Promise<TopicPoll> {
  const [options, mine] = await Promise.all([
    db
      .prepare(
        `SELECT o.id, o.label, COUNT(v.memberId)::int AS votes FROM topic_poll_options o
         LEFT JOIN topic_poll_votes v ON v.optionId = o.id
         WHERE o.topicId = ? GROUP BY o.id, o.label, o.position ORDER BY o.position, o.id`,
      )
      .all<PollOption>(topicId),
    viewerId === null
      ? Promise.resolve(undefined)
      : db.prepare("SELECT optionId FROM topic_poll_votes WHERE topicId = ? AND memberId = ?").get<{ optionId: number }>(topicId, viewerId),
  ]);
  const opts = options.map((o) => ({ id: Number(o.id), label: o.label, votes: Number(o.votes) }));
  return {
    options: opts,
    total: opts.reduce((s, o) => s + o.votes, 0),
    myOptionId: mine ? Number(mine.optionId) : null,
    closed,
  };
}

/**
 * Tópico pra quem lê. null = não existe, comunidade escondida (pra quem não
 * é admin) ou autor bloqueado nos dois sentidos. Removido continua
 * existindo: a página mostra "[removido pela moderação]" e a árvore.
 */
export async function getTopic(id: number, viewer: Actor | null): Promise<TopicDetail | null> {
  const r = await topicRow(id, viewer?.id ?? null);
  if (!r) return null;
  if (Number(r.hidden) && viewer?.role !== "admin") return null;
  if (viewer && r.memberId !== null && (await isBlockedEither(viewer.id, Number(r.memberId)))) return null;
  const access = await accessFor(Number(r.communityId), viewer);
  const s = toSummary(r);
  const hideText = s.deleted || (s.removed && !access.canModerate);
  return {
    ...s,
    body: hideText ? "" : r.body,
    editedAt: r.editedAt,
    acceptedReplyId: r.acceptedReplyId === null ? null : Number(r.acceptedReplyId),
    communitySlug: r.slug,
    communityName: r.communityName,
    poll: s.kind === "enquete" ? await pollFor(s.id, viewer?.id ?? null, s.locked || s.removed) : null,
    mine: !!viewer && r.memberId !== null && Number(r.memberId) === viewer.id && !s.deleted,
    isMember: access.isMember,
    canModerate: access.canModerate,
  };
}

export type TopicReply = {
  id: number;
  topicId: number;
  parentId: number | null;
  depth: number;
  /** vazio quando removida, apagada ou de alguém que você bloqueou/silenciou */
  body: string;
  score: number;
  myVote: -1 | 0 | 1;
  author: TopicAuthor | null;
  removed: boolean;
  deleted: boolean;
  /** autor bloqueado ou silenciado por quem lê: some o texto, a árvore fica */
  hidden: boolean;
  accepted: boolean;
  mine: boolean;
  createdAt: string;
  editedAt: string | null;
  children: TopicReply[];
};

type ReplyRow = {
  id: number;
  topicId: number;
  parentId: number | null;
  depth: number;
  body: string;
  score: number;
  myVote: number;
  memberId: number | null;
  username: string | null;
  name: string | null;
  avatarUrl: string | null;
  clerkId: string | null;
  removedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  editedAt: string | null;
};

const REPLY_SELECT = `SELECT r.id, r.topicId, r.parentId, r.depth, r.body, r.score, COALESCE(v.value, 0) AS myVote,
    r.memberId, m.username, m.name, m.avatarUrl, m.clerkId, r.removedAt, r.deletedAt, r.createdAt, r.editedAt
  FROM topic_replies r
  LEFT JOIN members m ON m.id = r.memberId
  LEFT JOIN topic_votes v ON v.targetType = 'reply' AND v.targetId = r.id AND v.memberId = @me`;

/**
 * Árvore de respostas. Irmãs ordenadas por "melhores" (score, depois mais
 * antiga) ou "novas". A aceita sobe pro topo entre as irmãs dela. Resposta
 * removida, apagada ou de autor escondido vira marcador e os filhos ficam.
 */
export async function listReplies(
  topicId: number,
  viewer: Actor | null,
  opts: { sort?: ReplySort; canModerate?: boolean; acceptedReplyId?: number | null } = {},
): Promise<TopicReply[]> {
  const meId = viewer?.id ?? null;
  const [rows, hidden] = await Promise.all([
    db
      .prepare(`${REPLY_SELECT} WHERE r.topicId = @t ORDER BY r.id ASC LIMIT 3000`)
      .all<ReplyRow>({ t: topicId, me: meId ?? -1 }),
    meId === null ? Promise.resolve({ blocked: [], muted: [] }) : hiddenIdsFor(meId),
  ]);
  const hide = new Set([...hidden.blocked, ...hidden.muted]);
  const byId = new Map<number, TopicReply>();
  for (const r of rows) {
    const memberId = r.memberId === null ? null : Number(r.memberId);
    const removed = r.removedAt !== null;
    const deleted = r.deletedAt !== null;
    const isHidden = memberId !== null && hide.has(memberId);
    const showBody = !deleted && !isHidden && (!removed || !!opts.canModerate);
    byId.set(Number(r.id), {
      id: Number(r.id),
      topicId: Number(r.topicId),
      parentId: r.parentId === null ? null : Number(r.parentId),
      depth: Number(r.depth),
      body: showBody ? r.body : "",
      score: Number(r.score),
      myVote: (Math.sign(Number(r.myVote)) as -1 | 0 | 1) || 0,
      author: deleted || isHidden || removed ? (removed && opts.canModerate && !deleted ? authorOf(r) : null) : authorOf(r),
      removed,
      deleted,
      hidden: isHidden,
      accepted: opts.acceptedReplyId != null && Number(r.id) === opts.acceptedReplyId,
      mine: meId !== null && memberId === meId && !deleted,
      createdAt: r.createdAt,
      editedAt: r.editedAt,
      children: [],
    });
  }
  const roots: TopicReply[] = [];
  for (const r of byId.values()) {
    const parent = r.parentId === null ? null : byId.get(r.parentId);
    (parent ? parent.children : roots).push(r);
  }
  const sort = opts.sort ?? "melhores";
  const cmp = (a: TopicReply, b: TopicReply) => {
    if (a.accepted !== b.accepted) return a.accepted ? -1 : 1;
    if (sort === "novas") return parseDbTime(b.createdAt).getTime() - parseDbTime(a.createdAt).getTime() || b.id - a.id;
    return b.score - a.score || parseDbTime(a.createdAt).getTime() - parseDbTime(b.createdAt).getTime() || a.id - b.id;
  };
  const sortTree = (list: TopicReply[]) => {
    list.sort(cmp);
    for (const r of list) sortTree(r.children);
  };
  sortTree(roots);
  return roots;
}

async function getReplyView(replyId: number, viewer: Actor): Promise<TopicReply | null> {
  const r = await db.prepare(`${REPLY_SELECT} WHERE r.id = @id`).get<ReplyRow>({ id: replyId, me: viewer.id });
  if (!r) return null;
  const t = await db.prepare("SELECT acceptedReplyId FROM community_topics WHERE id = ?").get<{ acceptedReplyId: number | null }>(r.topicId);
  return {
    id: Number(r.id),
    topicId: Number(r.topicId),
    parentId: r.parentId === null ? null : Number(r.parentId),
    depth: Number(r.depth),
    body: r.deletedAt || r.removedAt ? "" : r.body,
    score: Number(r.score),
    myVote: (Math.sign(Number(r.myVote)) as -1 | 0 | 1) || 0,
    author: r.deletedAt || r.removedAt ? null : authorOf(r),
    removed: r.removedAt !== null,
    deleted: r.deletedAt !== null,
    hidden: false,
    accepted: t?.acceptedReplyId != null && Number(t.acceptedReplyId) === Number(r.id),
    mine: r.memberId !== null && Number(r.memberId) === viewer.id && !r.deletedAt,
    createdAt: r.createdAt,
    editedAt: r.editedAt,
    children: [],
  };
}

// ---------- validação ----------

function cleanFlair(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().replace(/\s+/g, " ");
  return t ? t : null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export type TopicInput = { kind: TopicKind; title: string; body: string; flair: string | null; options: string[] };

/** valida o formulário de novo tópico; erro sai como TopicError 400 */
export function parseTopicInput(raw: unknown): TopicInput {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const kind = typeof o.kind === "string" && (TOPIC_KINDS as readonly string[]).includes(o.kind) ? (o.kind as TopicKind) : o.kind == null ? "discussao" : null;
  if (!kind) throw new TopicError("Tipo de tópico inválido.", 400);
  const title = str(o.title).replace(/\s+/g, " ");
  if (title.length < TOPIC_LIMITS.titleMin) throw new TopicError(`O título precisa de pelo menos ${TOPIC_LIMITS.titleMin} caracteres.`, 400);
  if (title.length > TOPIC_LIMITS.title) throw new TopicError(`Título até ${TOPIC_LIMITS.title} caracteres.`, 400);
  const body = str(o.body);
  if (body.length > TOPIC_LIMITS.body) throw new TopicError(`Texto até ${TOPIC_LIMITS.body} caracteres.`, 400);
  if (o.flair != null && typeof o.flair !== "string") throw new TopicError("Flair inválido.", 400);
  const flair = cleanFlair(o.flair);
  if (flair && flair.length > TOPIC_LIMITS.flair) throw new TopicError(`Flair até ${TOPIC_LIMITS.flair} caracteres.`, 400);
  let options: string[] = [];
  if (kind === "enquete") {
    if (!Array.isArray(o.options)) throw new TopicError(`Enquete precisa de ${TOPIC_LIMITS.pollMin} a ${TOPIC_LIMITS.pollMax} opções.`, 400);
    options = o.options.map((x) => str(x).replace(/\s+/g, " ")).filter(Boolean);
    if (options.length < TOPIC_LIMITS.pollMin || options.length > TOPIC_LIMITS.pollMax) {
      throw new TopicError(`Enquete precisa de ${TOPIC_LIMITS.pollMin} a ${TOPIC_LIMITS.pollMax} opções.`, 400);
    }
    if (options.some((x) => x.length > TOPIC_LIMITS.pollLabel)) throw new TopicError(`Cada opção até ${TOPIC_LIMITS.pollLabel} caracteres.`, 400);
    if (new Set(options.map((x) => x.toLowerCase())).size !== options.length) throw new TopicError("Tem opção repetida na enquete.", 400);
  }
  return { kind, title, body, flair, options };
}

function replyBody(v: unknown): string {
  const body = str(v);
  if (!body) throw new TopicError("Escreva a resposta.", 400);
  if (body.length > TOPIC_LIMITS.reply) throw new TopicError(`Resposta até ${TOPIC_LIMITS.reply} caracteres.`, 400);
  return body;
}

// ---------- escrita ----------

type Ctx = {
  id: number;
  communityId: number;
  slug: string;
  title: string;
  kind: TopicKind;
  memberId: number | null;
  pinnedAt: string | null;
  lockedAt: string | null;
  removedAt: string | null;
  deletedAt: string | null;
  replyCount: number;
} & Access;

/**
 * Carrega o tópico com o papel de quem age. 404 quando não existe, a
 * comunidade está escondida (pra quem não é admin) ou um bloqueou o outro.
 */
async function loadCtx(topicId: number, actor: Actor): Promise<Ctx> {
  const t = await db
    .prepare(
      `SELECT t.id, t.communityId, c.slug, c.hidden, t.title, t.kind, t.memberId, t.pinnedAt, t.lockedAt, t.removedAt, t.deletedAt, t.replyCount
       FROM community_topics t JOIN communities c ON c.id = t.communityId WHERE t.id = ?`,
    )
    .get<Omit<Ctx, keyof Access> & { hidden: number }>(topicId);
  if (!t || (Number(t.hidden) && actor.role !== "admin")) throw new TopicError("Tópico não encontrado.", 404);
  const memberId = t.memberId === null ? null : Number(t.memberId);
  if (memberId !== null && (await isBlockedEither(actor.id, memberId))) throw new TopicError("Tópico não encontrado.", 404);
  const access = await accessFor(Number(t.communityId), actor);
  return { ...t, id: Number(t.id), communityId: Number(t.communityId), memberId, replyCount: Number(t.replyCount), ...access };
}

async function mustParticipate(ctx: { isMember: boolean }, actor: Actor, what: string) {
  if (!ctx.isMember) throw new TopicError(`Só quem é da comunidade ${what}. Entre nela pra participar.`, 403);
  if (!(await canNetwork(actor.id))) throw new TopicError("Sua conta não pode participar de conversas.", 403);
}

/** cria o tópico (membro da comunidade); devolve o id */
export async function createTopic(communityId: number, actor: Actor, raw: unknown): Promise<number> {
  const access = await accessFor(communityId, actor);
  await mustParticipate(access, actor, "abre tópico");
  const input = parseTopicInput(raw);
  return db.transaction(async () => {
    const row = await db
      .prepare(
        `INSERT INTO community_topics (communityId, memberId, title, body, flair, kind)
         VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
      )
      .get<{ id: number }>(communityId, actor.id, input.title, input.body, input.flair, input.kind);
    const id = Number(row!.id);
    for (const [i, label] of input.options.entries()) {
      await db.prepare("INSERT INTO topic_poll_options (topicId, label, position) VALUES (?, ?, ?)").run(id, label, i);
    }
    return id;
  })();
}

async function recountReplies(topicId: number) {
  await db
    .prepare(
      `UPDATE community_topics SET replyCount =
         (SELECT COUNT(*)::int FROM topic_replies WHERE topicId = ? AND removedAt IS NULL AND deletedAt IS NULL)
       WHERE id = ?`,
    )
    .run(topicId, topicId);
}

const NOTIFY_TYPE = "topic-reply";

/**
 * Aviso de resposta agrupado: uma notificação não lida por pessoa por
 * tópico por hora. Se já existe, ela vira "novas respostas em …" (sem @,
 * porque já são várias pessoas) e aponta pra resposta mais nova.
 */
export async function notifyTopicReply(
  recipientId: number,
  actor: { id: number; username: string },
  topic: { id: number; slug: string; title: string },
  text: string,
  replyId: number,
): Promise<"created" | "grouped" | "skipped"> {
  if (recipientId === actor.id) return "skipped";
  const hidden = await hiddenIdsFor(recipientId);
  if (hidden.blocked.includes(actor.id) || hidden.muted.includes(actor.id)) return "skipped";
  if (!(await canNetwork(recipientId))) return "skipped";
  const base = topicHref(topic.slug, topic.id);
  const href = topicHref(topic.slug, topic.id, replyId);
  return db.transaction(async () => {
    await db.prepare("SELECT pg_advisory_xact_lock(hashtext(?::text)) AS ok").get(`topic-notify:${recipientId}:${topic.id}`);
    const recent = await db
      .prepare(
        `SELECT id FROM notifications
         WHERE memberId = ? AND type = ? AND read = 0 AND split_part(href, '#', 1) = ?
           AND to_ts(createdAt) >= now() - interval '1 hour'
         ORDER BY id DESC LIMIT 1`,
      )
      .get<{ id: number }>(recipientId, NOTIFY_TYPE, base);
    if (recent) {
      await db
        .prepare("UPDATE notifications SET text = ?, href = ?, actorId = NULL, actorUsername = NULL WHERE id = ?")
        .run(`Novas respostas em "${clip(topic.title, 80)}"`, href, recent.id);
      return "grouped" as const;
    }
    await notify(recipientId, { type: NOTIFY_TYPE, actorId: actor.id, actorUsername: actor.username, text, href });
    return "created" as const;
  })();
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Responde o tópico ou uma resposta. Resposta a uma de nível 6 vira irmã
 * dela. Tópico trancado ou removido não recebe resposta (403).
 */
export async function createReply(
  topicId: number,
  actor: Actor & { username: string },
  raw: { body?: unknown; parentId?: unknown },
): Promise<TopicReply> {
  const ctx = await loadCtx(topicId, actor);
  await mustParticipate(ctx, actor, "responde");
  if (ctx.removedAt) throw new TopicError("Esse tópico foi removido pela moderação.", 403);
  if (ctx.lockedAt) throw new TopicError("Tópico trancado: ninguém responde mais.", 403);
  const body = replyBody(raw.body);
  let parent: { id: number; parentId: number | null; depth: number; memberId: number | null } | null = null;
  if (raw.parentId != null) {
    const pid = typeof raw.parentId === "number" ? raw.parentId : typeof raw.parentId === "string" && /^\d{1,9}$/.test(raw.parentId) ? Number(raw.parentId) : NaN;
    if (!Number.isInteger(pid) || pid <= 0) throw new TopicError("Resposta inválida.", 400);
    const p = await db
      .prepare("SELECT id, topicId, parentId, depth, memberId, removedAt, deletedAt FROM topic_replies WHERE id = ?")
      .get<{ id: number; topicId: number; parentId: number | null; depth: number; memberId: number | null; removedAt: string | null; deletedAt: string | null }>(pid);
    if (!p || Number(p.topicId) !== topicId) throw new TopicError("Resposta inválida.", 400);
    if (p.removedAt || p.deletedAt) throw new TopicError("Essa resposta saiu do ar.", 400);
    if (p.memberId !== null && (await isBlockedEither(actor.id, Number(p.memberId)))) throw new TopicError("Resposta inválida.", 400);
    parent = { id: Number(p.id), parentId: p.parentId === null ? null : Number(p.parentId), depth: Number(p.depth), memberId: p.memberId === null ? null : Number(p.memberId) };
  }
  // passou do fundo: vira irmã da resposta de nível 6
  const parentId = parent ? (parent.depth >= TOPIC_LIMITS.depth ? parent.parentId : parent.id) : null;
  const depth = parent ? Math.min(parent.depth + 1, TOPIC_LIMITS.depth) : 1;
  const id = await db.transaction(async () => {
    const row = await db
      .prepare("INSERT INTO topic_replies (topicId, parentId, memberId, depth, body) VALUES (?, ?, ?, ?, ?) RETURNING id")
      .get<{ id: number }>(topicId, parentId, actor.id, depth, body);
    await recountReplies(topicId);
    await db.prepare("UPDATE community_topics SET lastActivityAt = sqlite_now() WHERE id = ?").run(topicId);
    return Number(row!.id);
  })();

  const topic = { id: topicId, slug: ctx.slug, title: ctx.title };
  // o autor do tópico ouve a resposta direta; quem escreveu a resposta
  // respondida ouve a filha (sem aviso duplicado pra mesma pessoa)
  const notified = new Set<number>();
  if (parent?.memberId != null) {
    await notifyTopicReply(parent.memberId, actor, topic, `@${actor.username} respondeu você em "${clip(ctx.title, 80)}"`, id);
    notified.add(parent.memberId);
  }
  if (ctx.memberId !== null && !ctx.deletedAt && !notified.has(ctx.memberId) && parent === null) {
    await notifyTopicReply(ctx.memberId, actor, topic, `@${actor.username} respondeu seu tópico "${clip(ctx.title, 80)}"`, id);
  }
  return (await getReplyView(id, actor))!;
}

export type VoteResult = { score: number; myVote: -1 | 0 | 1 };

function voteValue(v: unknown): -1 | 0 | 1 {
  if (v === 1 || v === -1 || v === 0) return v;
  if (v === null) return 0;
  throw new TopicError("Voto inválido: use 1, -1 ou 0.", 400);
}

async function applyVote(type: "topic" | "reply", targetId: number, memberId: number, value: -1 | 0 | 1): Promise<VoteResult> {
  const table = type === "topic" ? "community_topics" : "topic_replies";
  return db.transaction(async () => {
    // trava a linha do alvo: dois votos ao mesmo tempo somam certo
    await db.prepare(`SELECT id FROM ${table} WHERE id = ? FOR UPDATE`).get(targetId);
    if (value === 0) {
      await db.prepare("DELETE FROM topic_votes WHERE targetType = ? AND targetId = ? AND memberId = ?").run(type, targetId, memberId);
    } else {
      await db
        .prepare(
          `INSERT INTO topic_votes (targetType, targetId, memberId, value) VALUES (?, ?, ?, ?)
           ON CONFLICT (targetType, targetId, memberId) DO UPDATE SET value = EXCLUDED.value, createdAt = sqlite_now()`,
        )
        .run(type, targetId, memberId, value);
    }
    const r = await db
      .prepare(
        `UPDATE ${table} SET score = COALESCE((SELECT SUM(value) FROM topic_votes WHERE targetType = ? AND targetId = ?), 0)
         WHERE id = ? RETURNING score`,
      )
      .get<{ score: number }>(type, targetId, targetId);
    return { score: Number(r?.score ?? 0), myVote: value };
  })();
}

/** voto no tópico: 1, -1 ou 0 (desfaz). Membro, nunca no próprio. */
export async function voteTopic(topicId: number, actor: Actor, raw: unknown): Promise<VoteResult> {
  const value = voteValue(raw);
  const ctx = await loadCtx(topicId, actor);
  await mustParticipate(ctx, actor, "vota");
  if (ctx.memberId === actor.id) throw new TopicError("Não dá pra votar no que é seu.", 400);
  if (ctx.removedAt || ctx.deletedAt) throw new TopicError("Esse tópico saiu do ar.", 403);
  return applyVote("topic", topicId, actor.id, value);
}

/** voto numa resposta do tópico (mesmas regras) */
export async function voteReply(topicId: number, replyId: number, actor: Actor, raw: unknown): Promise<VoteResult> {
  const value = voteValue(raw);
  const ctx = await loadCtx(topicId, actor);
  await mustParticipate(ctx, actor, "vota");
  const r = await replyIn(topicId, replyId);
  if (r.memberId !== null && (await isBlockedEither(actor.id, r.memberId))) throw new TopicError("Resposta não encontrada.", 404);
  if (r.memberId === actor.id) throw new TopicError("Não dá pra votar no que é seu.", 400);
  if (r.removedAt || r.deletedAt) throw new TopicError("Essa resposta saiu do ar.", 403);
  return applyVote("reply", replyId, actor.id, value);
}

async function replyIn(topicId: number, replyId: number) {
  const r = await db
    .prepare("SELECT id, topicId, memberId, removedAt, deletedAt FROM topic_replies WHERE id = ?")
    .get<{ id: number; topicId: number; memberId: number | null; removedAt: string | null; deletedAt: string | null }>(replyId);
  if (!r || Number(r.topicId) !== topicId) throw new TopicError("Resposta não encontrada.", 404);
  return { ...r, id: Number(r.id), memberId: r.memberId === null ? null : Number(r.memberId) };
}

/** voto na enquete: um por pessoa; votar de novo troca a opção */
export async function votePoll(topicId: number, actor: Actor, rawOption: unknown): Promise<TopicPoll> {
  const ctx = await loadCtx(topicId, actor);
  if (ctx.kind !== "enquete") throw new TopicError("Esse tópico não é enquete.", 400);
  await mustParticipate(ctx, actor, "vota");
  if (ctx.removedAt || ctx.deletedAt) throw new TopicError("Esse tópico saiu do ar.", 403);
  if (ctx.lockedAt) throw new TopicError("Enquete encerrada: o tópico foi trancado.", 403);
  const optionId = typeof rawOption === "number" ? rawOption : typeof rawOption === "string" && /^\d{1,9}$/.test(rawOption) ? Number(rawOption) : NaN;
  const opt = Number.isInteger(optionId)
    ? await db.prepare("SELECT id FROM topic_poll_options WHERE id = ? AND topicId = ?").get<{ id: number }>(optionId, topicId)
    : undefined;
  if (!opt) throw new TopicError("Opção inválida.", 400);
  await db
    .prepare(
      `INSERT INTO topic_poll_votes (topicId, optionId, memberId) VALUES (?, ?, ?)
       ON CONFLICT (topicId, memberId) DO UPDATE SET optionId = EXCLUDED.optionId, createdAt = sqlite_now()`,
    )
    .run(topicId, optionId, actor.id);
  return pollFor(topicId, actor.id, false);
}

/** autor da pergunta marca (ou desmarca, com null) a resposta que resolveu */
export async function acceptReply(topicId: number, actor: Actor, rawReply: unknown): Promise<{ acceptedReplyId: number | null }> {
  const ctx = await loadCtx(topicId, actor);
  if (ctx.memberId !== actor.id || ctx.deletedAt) throw new TopicError("Só quem perguntou marca a resposta que resolveu.", 403);
  if (ctx.kind !== "pergunta") throw new TopicError("Só pergunta tem resposta que resolveu.", 400);
  if (ctx.removedAt) throw new TopicError("Esse tópico foi removido pela moderação.", 403);
  let replyId: number | null = null;
  if (rawReply !== null && rawReply !== undefined) {
    const id = typeof rawReply === "number" ? rawReply : typeof rawReply === "string" && /^\d{1,9}$/.test(rawReply) ? Number(rawReply) : NaN;
    if (!Number.isInteger(id)) throw new TopicError("Resposta inválida.", 400);
    const r = await replyIn(topicId, id);
    if (r.removedAt || r.deletedAt) throw new TopicError("Essa resposta saiu do ar.", 400);
    replyId = r.id;
  }
  await db.prepare("UPDATE community_topics SET acceptedReplyId = ? WHERE id = ?").run(replyId, topicId);
  return { acceptedReplyId: replyId };
}

export type TopicPatch = { title?: unknown; body?: unknown; flair?: unknown; pinned?: unknown; locked?: unknown };

/**
 * Edição. Título e corpo: só o autor (marca editedAt). Flair: autor ou
 * moderação. Fixar (até 3) e trancar: só moderação (403 pra membro).
 */
export async function updateTopic(topicId: number, actor: Actor, patch: TopicPatch): Promise<void> {
  const ctx = await loadCtx(topicId, actor);
  const author = ctx.memberId === actor.id && !ctx.deletedAt;
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (patch.title !== undefined || patch.body !== undefined) {
    if (!author) throw new TopicError("Só quem escreveu edita o tópico.", 403);
    if (ctx.removedAt) throw new TopicError("Esse tópico foi removido pela moderação.", 403);
    if (patch.title !== undefined) {
      const title = str(patch.title).replace(/\s+/g, " ");
      if (title.length < TOPIC_LIMITS.titleMin || title.length > TOPIC_LIMITS.title) {
        throw new TopicError(`O título tem de ${TOPIC_LIMITS.titleMin} a ${TOPIC_LIMITS.title} caracteres.`, 400);
      }
      sets.push("title = ?");
      vals.push(title);
    }
    if (patch.body !== undefined) {
      const body = str(patch.body);
      if (body.length > TOPIC_LIMITS.body) throw new TopicError(`Texto até ${TOPIC_LIMITS.body} caracteres.`, 400);
      sets.push("body = ?");
      vals.push(body);
    }
    sets.push("editedAt = sqlite_now()");
  }
  if (patch.flair !== undefined) {
    if (!author && !ctx.canModerate) throw new TopicError("Forbidden", 403);
    if (patch.flair !== null && typeof patch.flair !== "string") throw new TopicError("Flair inválido.", 400);
    const flair = cleanFlair(patch.flair);
    if (flair && flair.length > TOPIC_LIMITS.flair) throw new TopicError(`Flair até ${TOPIC_LIMITS.flair} caracteres.`, 400);
    sets.push("flair = ?");
    vals.push(flair);
  }
  if (patch.pinned !== undefined || patch.locked !== undefined) {
    if (!ctx.canModerate) throw new TopicError("Só quem organiza a comunidade fixa e tranca tópico.", 403);
    if (patch.locked !== undefined) {
      if (typeof patch.locked !== "boolean") throw new TopicError("Valor inválido.", 400);
      sets.push(`lockedAt = ${patch.locked ? "COALESCE(lockedAt, sqlite_now())" : "NULL"}`);
    }
    if (patch.pinned !== undefined) {
      if (typeof patch.pinned !== "boolean") throw new TopicError("Valor inválido.", 400);
      if (patch.pinned && !ctx.pinnedAt) {
        if (ctx.removedAt) throw new TopicError("Tópico removido não fica fixado.", 400);
        const n = await db
          .prepare("SELECT COUNT(*)::int AS n FROM community_topics WHERE communityId = ? AND pinnedAt IS NOT NULL AND removedAt IS NULL")
          .get<{ n: number }>(ctx.communityId);
        if (Number(n?.n ?? 0) >= TOPIC_LIMITS.pinned) {
          throw new TopicError(`Já tem ${TOPIC_LIMITS.pinned} tópicos fixados. Solte um antes.`, 409);
        }
      }
      sets.push(`pinnedAt = ${patch.pinned ? "COALESCE(pinnedAt, sqlite_now())" : "NULL"}`);
    }
  }
  if (!sets.length) throw new TopicError("Nada pra mudar.", 400);
  await db.prepare(`UPDATE community_topics SET ${sets.join(", ")} WHERE id = ?`).run(...(vals as (string | null)[]), topicId);
}

async function hardDeleteTopic(topicId: number) {
  await db
    .prepare(
      `DELETE FROM topic_votes WHERE (targetType = 'topic' AND targetId = ?)
         OR (targetType = 'reply' AND targetId IN (SELECT id FROM topic_replies WHERE topicId = ?))`,
    )
    .run(topicId, topicId);
  await db.prepare("DELETE FROM community_topics WHERE id = ?").run(topicId);
}

async function hasOthersReplies(topicId: number, authorId: number | null): Promise<boolean> {
  const r = await db
    .prepare("SELECT EXISTS (SELECT 1 FROM topic_replies WHERE topicId = ? AND memberId IS DISTINCT FROM ?::int) AS x")
    .get<{ x: boolean }>(topicId, authorId);
  return Boolean(r?.x);
}

/**
 * Apagar tópico. O autor apaga o próprio: sem resposta de outra pessoa some
 * de vez; com resposta vira "[apagado]" e a conversa fica. A moderação
 * remove: "[removido pela moderação]", árvore mantida, fora da lista.
 */
export async function deleteTopic(topicId: number, actor: Actor): Promise<"deleted" | "soft" | "removed"> {
  const ctx = await loadCtx(topicId, actor);
  if (ctx.memberId === actor.id && !ctx.deletedAt) {
    return db.transaction(async () => {
      if (await hasOthersReplies(topicId, actor.id)) {
        await db
          .prepare("UPDATE community_topics SET body = '', memberId = NULL, deletedAt = sqlite_now(), pinnedAt = NULL WHERE id = ?")
          .run(topicId);
        return "soft" as const;
      }
      await hardDeleteTopic(topicId);
      return "deleted" as const;
    })();
  }
  if (!ctx.canModerate) throw new TopicError("Forbidden", 403);
  if (ctx.removedAt) return "removed";
  await db
    .prepare("UPDATE community_topics SET removedAt = sqlite_now(), removedBy = ?, pinnedAt = NULL WHERE id = ?")
    .run(actor.id, topicId);
  return "removed";
}

/** autor edita a própria resposta (marca editedAt) */
export async function updateReply(topicId: number, replyId: number, actor: Actor, rawBody: unknown): Promise<TopicReply> {
  await loadCtx(topicId, actor);
  const r = await replyIn(topicId, replyId);
  if (r.memberId !== actor.id || r.deletedAt) throw new TopicError("Só quem escreveu edita a resposta.", 403);
  if (r.removedAt) throw new TopicError("Essa resposta foi removida pela moderação.", 403);
  const body = replyBody(rawBody);
  await db.prepare("UPDATE topic_replies SET body = ?, editedAt = sqlite_now() WHERE id = ?").run(body, replyId);
  return (await getReplyView(replyId, actor))!;
}

/**
 * Apagar resposta. Autor: sem filhas some de vez; com filhas vira
 * "[apagado]". Moderação: "[removido pela moderação]". A árvore fica.
 */
export async function deleteReply(topicId: number, replyId: number, actor: Actor): Promise<"deleted" | "soft" | "removed"> {
  const ctx = await loadCtx(topicId, actor);
  const r = await replyIn(topicId, replyId);
  let result: "deleted" | "soft" | "removed";
  if (r.memberId === actor.id && !r.deletedAt) {
    result = await db.transaction(async () => {
      const kids = await db.prepare("SELECT EXISTS (SELECT 1 FROM topic_replies WHERE parentId = ?) AS x").get<{ x: boolean }>(replyId);
      if (kids?.x) {
        await db.prepare("UPDATE topic_replies SET body = '', memberId = NULL, deletedAt = sqlite_now() WHERE id = ?").run(replyId);
        return "soft" as const;
      }
      await db.prepare("DELETE FROM topic_votes WHERE targetType = 'reply' AND targetId = ?").run(replyId);
      await db.prepare("DELETE FROM topic_replies WHERE id = ?").run(replyId);
      return "deleted" as const;
    })();
  } else {
    if (!ctx.canModerate) throw new TopicError("Forbidden", 403);
    if (!r.removedAt) {
      await db.prepare("UPDATE topic_replies SET removedAt = sqlite_now(), removedBy = ? WHERE id = ?").run(actor.id, replyId);
    }
    result = "removed";
  }
  // resposta que resolveu e saiu do ar deixa de resolver
  await db.prepare("UPDATE community_topics SET acceptedReplyId = NULL WHERE id = ? AND acceptedReplyId = ?").run(topicId, replyId);
  await recountReplies(topicId);
  return result;
}

// ---------- LGPD ----------

/**
 * Exclusão da conta (lib/privacy.ts chama antes da varredura genérica).
 * Conteúdo com resposta de outra pessoa vira "[apagado]" (sem autor, sem
 * texto); o resto sai de vez. Os votos da pessoa saem e o score dos alvos é
 * recalculado; o voto em enquete sai junto.
 */
export async function forgetTopicAuthor(memberId: number): Promise<void> {
  // respostas com filha: marcador; sem filha: some
  await db
    .prepare(
      `UPDATE topic_replies r SET body = '', memberId = NULL, deletedAt = COALESCE(r.deletedAt, sqlite_now()), editedAt = NULL
       WHERE r.memberId = ? AND EXISTS (SELECT 1 FROM topic_replies k WHERE k.parentId = r.id)`,
    )
    .run(memberId);
  const gone = await db
    .prepare("DELETE FROM topic_replies WHERE memberId = ? RETURNING id, topicId")
    .all<{ id: number; topicId: number }>(memberId);
  // tópicos com resposta de outra pessoa: marcador; sem: somem
  await db
    .prepare(
      `UPDATE community_topics t SET title = '[apagado]', body = '', flair = NULL, memberId = NULL,
         deletedAt = COALESCE(t.deletedAt, sqlite_now()), editedAt = NULL, pinnedAt = NULL
       WHERE t.memberId = ? AND EXISTS (SELECT 1 FROM topic_replies k WHERE k.topicId = t.id)`,
    )
    .run(memberId);
  const own = await db.prepare("SELECT id FROM community_topics WHERE memberId = ?").all<{ id: number }>(memberId);
  for (const t of own) await hardDeleteTopic(Number(t.id));
  if (gone.length) {
    await db
      .prepare(`DELETE FROM topic_votes WHERE targetType = 'reply' AND targetId = ANY(?::int[])`)
      .run(`{${gone.map((g) => Number(g.id)).join(",")}}`);
  }
  const voted = await db
    .prepare("DELETE FROM topic_votes WHERE memberId = ? RETURNING targetType, targetId")
    .all<{ targetType: "topic" | "reply"; targetId: number }>(memberId);
  for (const v of voted) {
    const table = v.targetType === "topic" ? "community_topics" : "topic_replies";
    await db
      .prepare(
        `UPDATE ${table} SET score = COALESCE((SELECT SUM(value) FROM topic_votes WHERE targetType = ? AND targetId = ?), 0) WHERE id = ?`,
      )
      .run(v.targetType, v.targetId, v.targetId);
  }
  await db.prepare("DELETE FROM topic_poll_votes WHERE memberId = ?").run(memberId);
  for (const topicId of new Set(gone.map((g) => Number(g.topicId)))) await recountReplies(topicId);
}

// ---------- HTTP ----------

/** TopicError vira a resposta com o status dela; o resto sobe (500) */
export function topicErrorResponse(e: unknown): Response {
  if (e instanceof TopicError) return Response.json({ error: e.message }, { status: e.status });
  throw e;
}
