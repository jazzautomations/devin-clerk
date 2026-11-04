import db from "@/lib/db";

export type Notification = {
  id: number;
  memberId: number;
  actorUsername: string | null;
  // quem causou, por id (migration 031). Dedupe e "não notificar a si mesmo"
  // usam o id; o @ acima é só pra exibir.
  actorId: number | null;
  type: string;
  text: string;
  href: string | null;
  read: boolean;
  createdAt: string;
};

type NotificationRow = Omit<Notification, "read"> & { read: number };

const toNotification = (row: NotificationRow): Notification => ({
  ...row,
  read: Boolean(row.read),
});

// ---------- grupos e preferências (migration 040) ----------

/**
 * Grupo de cada tipo de notificação. TIPO NOVO ENTRA AQUI NA MESMA PR: tipo
 * fora do mapa cai em "essencial", que não desliga e não agrupa.
 * - social: o que outra pessoa fez com você ou com o que você postou.
 * - comunidade: vida das comunidades que você segue ou de que faz parte.
 * - essencial: inscrição, ingresso, RSVP, time, júri, certificado, moderação.
 */
export type NotificationGroupName = "social" | "comunidade" | "essencial";
export const TYPE_GROUP: Record<string, NotificationGroupName> = {
  like: "social",
  reaction: "social",
  comment: "social",
  reply: "social",
  mention: "social",
  follow: "social",
  testimonial: "social",
  recado: "social",
  repost: "social",
  quote: "social",
  project_update: "social",
  encontro: "social",
  dm: "social",
  community_join: "comunidade",
  community_notice: "comunidade",
  edicao_nova: "comunidade",
  agenda: "comunidade",
  // item do bicho (migration 047): conquista pessoal, sem ator. Não desliga e
  // não agrupa — é o mesmo tratamento do resto de "essencial".
  mascote_item: "essencial",
  // 4 semanas depois (migration 052): entrar com o time é vida do time
  // (comunidade); o lembrete de quinta e o selo são essencial — o lembrete é
  // sem culpa e não existe aviso de sequência.
  follow_through_join: "comunidade",
  follow_through_reminder: "essencial",
  follow_through_badge: "essencial",
};

export function groupOf(type: string): NotificationGroupName {
  return TYPE_GROUP[type] ?? "essencial";
}

/** grupos que a pessoa liga e desliga; "essencial" fica de fora de propósito */
export type PrefGroup = "social" | "comunidade" | "digest";
export const PREF_GROUPS: PrefGroup[] = ["social", "comunidade", "digest"];
export type GroupPref = { inApp: boolean; email: boolean };
export type NotificationPrefs = Record<PrefGroup, GroupPref>;

/** sem linha em notification_prefs vale isto */
export const DEFAULT_PREFS: NotificationPrefs = {
  social: { inApp: true, email: false },
  comunidade: { inApp: true, email: false },
  digest: { inApp: false, email: true },
};

export const isPrefGroup = (g: unknown): g is PrefGroup =>
  typeof g === "string" && (PREF_GROUPS as string[]).includes(g);

export async function getPrefs(memberId: number): Promise<NotificationPrefs> {
  const rows = await db
    .prepare(`SELECT "group", inApp, email FROM notification_prefs WHERE memberId = ?`)
    .all<{ group: string; inApp: number; email: number }>(memberId);
  const prefs: NotificationPrefs = {
    social: { ...DEFAULT_PREFS.social },
    comunidade: { ...DEFAULT_PREFS.comunidade },
    digest: { ...DEFAULT_PREFS.digest },
  };
  for (const r of rows) {
    if (isPrefGroup(r.group)) prefs[r.group] = { inApp: r.inApp === 1, email: r.email === 1 };
  }
  return prefs;
}

/** grava um grupo; o que não veio no patch fica como estava (ou no padrão) */
export async function setPref(
  memberId: number,
  group: PrefGroup,
  patch: Partial<GroupPref>,
): Promise<GroupPref> {
  const cur = (await getPrefs(memberId))[group];
  const next = { inApp: patch.inApp ?? cur.inApp, email: patch.email ?? cur.email };
  await db
    .prepare(
      `INSERT INTO notification_prefs (memberId, "group", inApp, email) VALUES (?, ?, ?, ?)
       ON CONFLICT (memberId, "group") DO UPDATE SET inApp = EXCLUDED.inApp, email = EXCLUDED.email, updatedAt = sqlite_now()`,
    )
    .run(memberId, group, next.inApp ? 1 : 0, next.email ? 1 : 0);
  return next;
}

/**
 * Fragmento SQL pra INSERT em massa (aviso de comunidade, edição nova): só
 * entra quem não desligou o grupo no app. `col` é a coluna com o id do
 * destinatário.
 */
export function inAppAllowedSql(group: "social" | "comunidade", col: string): string {
  return `NOT EXISTS (SELECT 1 FROM notification_prefs np
    WHERE np.memberId = ${col} AND np."group" = '${group}' AND np.inApp = 0)`;
}

/**
 * Cria uma notificação pro membro. actorUsername é texto congelado (recado
 * histórico, não FK); actorId é quem causou, por id. Sem actorId, o id é
 * resolvido pelo @ no momento do envio. Nunca notifica a si mesmo: se o ator
 * é o destinatário, é skip silencioso — curtir o próprio post não é novidade.
 *
 * Migration 040: não grava quando o grupo do tipo (TYPE_GROUP) está
 * desligado no app, e notificação social de quem o destinatário silenciou
 * ou de quem está bloqueado (dois sentidos) não nasce.
 */
export async function notify(
  memberId: number,
  opts: {
    type: string;
    actorUsername?: string;
    actorId?: number;
    text: string;
    href?: string;
  },
): Promise<void> {
  if (opts.actorId !== undefined) {
    if (opts.actorId === memberId) return;
  } else if (opts.actorUsername) {
    const target = await db
      .prepare("SELECT username FROM members WHERE id = ?")
      .get<{ username: string }>(memberId);
    if (target?.username === opts.actorUsername) return;
  }
  const group = groupOf(opts.type);
  const social = group === "social" ? 1 : 0;
  // uma ida ao banco: o INSERT só acontece se o grupo está ligado e, no
  // social, se o ator não está silenciado nem bloqueado
  await db.prepare(
    `WITH actor AS (
       SELECT COALESCE(@actorId::int, (SELECT id FROM members WHERE username = @actorUsername::text)) AS id
     )
     INSERT INTO notifications (memberId, actorUsername, actorId, type, text, href)
     SELECT @me::int, @actorUsername::text, actor.id, @type::text, @text::text, @href::text FROM actor
     WHERE (@group::text = 'essencial' OR NOT EXISTS (
         SELECT 1 FROM notification_prefs np WHERE np.memberId = @me::int AND np."group" = @group::text AND np.inApp = 0))
       AND (@social::int = 0 OR actor.id IS NULL OR NOT (
         EXISTS (SELECT 1 FROM member_mutes x WHERE x.memberId = @me AND x.mutedId = actor.id)
         OR EXISTS (SELECT 1 FROM member_blocks x
           WHERE (x.memberId = @me AND x.blockedId = actor.id) OR (x.memberId = actor.id AND x.blockedId = @me))))`,
  ).run({
    me: memberId,
    actorId: opts.actorId ?? null,
    actorUsername: opts.actorUsername ?? null,
    type: opts.type,
    text: opts.text,
    href: opts.href ?? null,
    group,
    social,
  });
}

/**
 * Já existe notificação desse ator pra esse membro, desse tipo, com esse
 * destino? Regra "1 por par" das ondas seguintes (seguir, depoimento, recado).
 * Por id: trocar de @ não fura. sinceDays = null olha a história inteira;
 * href null casa com notificação sem destino.
 */
export async function alreadyNotified(
  memberId: number,
  type: string,
  actorId: number,
  href: string | null,
  sinceDays: number | null,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS y FROM notifications
       WHERE memberId = ? AND type = ? AND actorId = ?
         AND href IS NOT DISTINCT FROM ?::text
         AND (?::int IS NULL OR to_ts(createdAt) >= now() - make_interval(days => ?::int))
       LIMIT 1`,
    )
    .get<{ y: number }>(memberId, type, actorId, href, sinceDays, sinceDays);
  return !!row;
}
/**
 * "1 por par" sem corrida: a checagem e o INSERT rodam numa transação sob
 * uma trava por (membro, tipo, ator, destino). Duas requisições ao mesmo
 * tempo (curti e ajudou em paralelo) não geram duas notificações.
 * true = notificou agora.
 */
export async function notifyOnce(
  memberId: number,
  opts: { type: string; actorId: number; actorUsername?: string; text: string; href: string | null },
  sinceDays: number | null = null,
): Promise<boolean> {
  if (opts.actorId === memberId) return false;
  return db.transaction(async () => {
    await db
      .prepare("SELECT pg_advisory_xact_lock(hashtext(?::text)) AS ok")
      .get(`notify:${memberId}:${opts.type}:${opts.actorId}:${opts.href ?? ""}`);
    if (await alreadyNotified(memberId, opts.type, opts.actorId, opts.href, sinceDays)) return false;
    await notify(memberId, { ...opts, href: opts.href ?? undefined });
    return true;
  })();
}

// migration 032: notificação de quem eu silenciei ou de quem está bloqueado
// (dois sentidos) some da lista e da contagem. O ator é casado pelo actorId,
// que não muda quando a pessoa troca o @.
const NOT_HIDDEN = `(notifications.actorId IS NULL OR NOT (
    EXISTS (SELECT 1 FROM member_mutes x WHERE x.memberId = @me AND x.mutedId = notifications.actorId)
    OR EXISTS (SELECT 1 FROM member_blocks x WHERE (x.memberId = @me AND x.blockedId = notifications.actorId) OR (x.memberId = notifications.actorId AND x.blockedId = @me))))`;

export async function listNotifications(
  memberId: number,
  limit = 50,
): Promise<Notification[]> {
  const rows = await db
    .prepare(
      `SELECT * FROM notifications WHERE memberId = @me AND ${NOT_HIDDEN} ORDER BY id DESC LIMIT @limit`,
    )
    .all({ me: memberId, limit }) as NotificationRow[];
  return rows.map(toNotification);
}

/** não lidas visíveis; com `window`, só as criadas em [from, to] (o resumo semanal) */
export async function unreadCount(
  memberId: number,
  window?: { from: string; to: string },
): Promise<number> {
  const range = window
    ? " AND to_ts(createdAt) >= @from::timestamptz AND to_ts(createdAt) <= @to::timestamptz"
    : "";
  return (
    await db
      .prepare(
        `SELECT COUNT(*) n FROM notifications WHERE memberId = @me AND read = 0 AND ${NOT_HIDDEN}${range}`,
      )
      .get({ me: memberId, ...(window ?? {}) }) as { n: number }
  ).n;
}

export async function markAllRead(memberId: number): Promise<void> {
  await db.prepare("UPDATE notifications SET read = 1 WHERE memberId = ?").run(
    memberId,
  );
}

/** só caminho interno ("/x", nunca "//host" nem esquema) — o open não vira redirect aberto */
export function safeHref(href: string | null): string {
  return href && href.startsWith("/") && !href.startsWith("//") && !href.startsWith("/\\")
    ? href
    : "/notificacoes";
}

/**
 * Abrir uma notificação = marcar como lida + destino. null quando a
 * notificação não é do membro (não vaza nem o href de outra pessoa).
 */
export async function openNotification(id: number, memberId: number, now = new Date()): Promise<string | null> {
  const siblings = await markGroupSiblingsRead(id, memberId, now);
  const row = await db
    .prepare("UPDATE notifications SET read = 1 WHERE id = ? AND memberId = ? RETURNING type, href")
    .get<{ type: string; href: string | null }>(id, memberId);
  if (!row) return null;
  return safeHref(siblings > 0 ? (groupHref(row.type) ?? row.href) : row.href);
}

/**
 * Marca como lida. Escopo por memberId — marcar a dos outros é no-op
 * silencioso. Com `group`, se a notificação é cabeça de um grupo (mesmo tipo
 * e destino, não lidas, últimas 24h), o grupo inteiro fica lido junto: a
 * pessoa clicou numa linha só (sino e /notificacoes).
 */
export async function markRead(
  id: number,
  memberId: number,
  opts: { group?: boolean; now?: Date } = {},
): Promise<void> {
  if (opts.group) await markGroupSiblingsRead(id, memberId, opts.now ?? new Date());
  await db.prepare(
    "UPDATE notifications SET read = 1 WHERE id = ? AND memberId = ?",
  ).run(id, memberId);
}

async function markGroupSiblingsRead(id: number, memberId: number, now: Date): Promise<number> {
  const res = await db
    .prepare(
      `UPDATE notifications s SET read = 1
       FROM notifications h
       WHERE h.id = @id AND h.memberId = @me AND s.memberId = @me AND s.read = 0 AND s.id < h.id
         AND s.type = h.type AND ${groupTarget("s")} = ${groupTarget("h")}
         AND s.type = ANY(@groupable::text[])
         AND to_ts(s.createdAt) >= @cutoff::timestamptz`,
    )
    .run({ id, me: memberId, groupable: pgArray(GROUPABLE_TYPES), cutoff: groupCutoff(now) });
  return res.changes;
}

// ---------- lista agrupada (migration 040) ----------

/**
 * Frase do grupo, por tipo: "@a, @b e mais 3 reagiram ao seu post". Só tipo
 * com frase aqui agrupa; o resto aparece uma linha por notificação.
 */
const PLURAL: Record<string, string> = {
  like: "curtiram seu post",
  reaction: "reagiram ao seu post",
  comment: "comentaram no seu post",
  reply: "responderam você",
  mention: "mencionaram você",
  follow: "começaram a seguir você",
  testimonial: "escreveram um depoimento pra você",
  recado: "deixaram recado no seu perfil",
  repost: "repostaram seu post",
  quote: "citaram seu post",
  project_update: "atualizaram projetos que você acompanha",
  community_join: "entraram na sua comunidade",
};
export const GROUPABLE_TYPES = Object.keys(PLURAL);
/** aba "menções" do /notificacoes */
export const MENTION_TYPES = ["mention"];

/**
 * O "destino" que junta notificações do mesmo tipo num grupo, em SQL. O href
 * de algumas é único por evento e não serve de chave:
 * - follow: /u/<quem seguiu>. Todo seguidor novo do dia vira um grupo só.
 * - comment, reply: /post/<id>#c-<comentário>. Agrupa pelo post, sem o #.
 * - o resto: o href inteiro.
 */
function groupTarget(alias: string): string {
  return `CASE WHEN ${alias}.type = 'follow' THEN ''
    WHEN ${alias}.type IN ('comment', 'reply') THEN split_part(COALESCE(${alias}.href, ''), '#', 1)
    ELSE COALESCE(${alias}.href, '') END`;
}

/** destino da linha agrupada quando o href de cada uma aponta pra uma pessoa só */
const GROUP_HREF: Record<string, string> = { follow: "/perfil/seguidores" };
const groupHref = (type: string): string | null => GROUP_HREF[type] ?? null;

/** janela do agrupamento: não lidas das últimas 24h */
export const GROUP_WINDOW_MS = 24 * 60 * 60 * 1000;
const groupCutoff = (now: Date) => new Date(now.getTime() - GROUP_WINDOW_MS).toISOString();

// literal de array do Postgres pra texto simples (tipos são snake_case)
const pgArray = (xs: (string | number)[]) => `{${xs.join(",")}}`;

export type NotificationActor = { id: number | null; username: string; name: string | null; avatarUrl: string | null };

export type NotificationGroup = {
  /** a mais recente do grupo: abrir/marcar usa este id */
  id: number;
  ids: number[];
  type: string;
  group: NotificationGroupName;
  text: string;
  href: string | null;
  read: boolean;
  createdAt: string;
  /** até 3, do mais recente pro mais antigo, por actorId */
  actors: NotificationActor[];
  /** pessoas diferentes no grupo */
  actorCount: number;
  /** notificações no grupo */
  total: number;
};

const joinPt = (xs: string[]) =>
  xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} e ${xs[xs.length - 1]}`;

/** texto da linha agrupada; com uma pessoa só fica o texto original */
export function groupedText(type: string, actors: string[], actorCount: number, fallback: string): string {
  const verb = PLURAL[type];
  if (!verb || actorCount <= 1) return fallback;
  const at = actors.map((a) => `@${a}`);
  if (actorCount <= 3) {
    if (at.length < actorCount) return fallback;
    return `${joinPt(at)} ${verb}`;
  }
  if (at.length < 2) return fallback;
  return `${at[0]}, ${at[1]} e mais ${actorCount - 2} ${verb}`;
}

type GroupRow = { head: number; total: number; ids: number[] | string };
type MemberRow = NotificationRow & { actorCurrent: string | null; actorName: string | null; actorAvatar: string | null };

const parseIds = (v: number[] | string): number[] =>
  Array.isArray(v) ? v.map(Number) : v.replace(/[{}]/g, "").split(",").filter(Boolean).map(Number);

/**
 * Lista agrupada e paginada. Não lidas de mesmo tipo e destino nas últimas
 * 24h viram uma linha (só tipos com frase em PLURAL). Cursor: `antes` é o
 * id da cabeça do último grupo da página anterior; `next` vem null quando
 * acabou. Notificação de quem eu silenciei ou bloqueei fica de fora.
 */
export async function listNotificationsGrouped(
  memberId: number,
  antes: number | null = null,
  limit = 30,
  opts: { only?: "mencoes"; now?: Date } = {},
): Promise<{ items: NotificationGroup[]; next: number | null }> {
  const now = opts.now ?? new Date();
  const lim = Math.max(1, Math.min(100, Math.floor(limit)));
  const only = opts.only === "mencoes" ? pgArray(MENTION_TYPES) : null;
  const groups = await db
    .prepare(
      `WITH base AS (
         SELECT id, CASE
             WHEN read = 0 AND type = ANY(@groupable::text[]) AND to_ts(createdAt) >= @cutoff::timestamptz
             THEN 'g:' || type || ':' || ${groupTarget("notifications")}
             ELSE 'n:' || id END AS gkey
         FROM notifications
         WHERE memberId = @me AND ${NOT_HIDDEN}
           AND (@only::text[] IS NULL OR type = ANY(@only::text[]))
       )
       SELECT MAX(id) AS head, COUNT(*)::int AS total, array_agg(id ORDER BY id DESC) AS ids
       FROM base GROUP BY gkey
       HAVING (@antes::int IS NULL OR MAX(id) < @antes::int)
       ORDER BY head DESC LIMIT @lim::int`,
    )
    .all<GroupRow>({
      me: memberId,
      groupable: pgArray(GROUPABLE_TYPES),
      cutoff: groupCutoff(now),
      only,
      antes,
      lim: lim + 1,
    });
  const page = groups.slice(0, lim);
  const next = groups.length > lim ? page[page.length - 1].head : null;
  if (page.length === 0) return { items: [], next: null };

  const allIds = page.flatMap((g) => parseIds(g.ids));
  const rows = await db
    .prepare(
      `SELECT n.*, a.username AS "actorCurrent", a.name AS "actorName", a.avatarUrl AS "actorAvatar"
       FROM notifications n LEFT JOIN members a ON a.id = n.actorId
       WHERE n.memberId = @me AND n.id = ANY(@ids::int[]) ORDER BY n.id DESC`,
    )
    .all<MemberRow>({ me: memberId, ids: pgArray(allIds) });
  const byId = new Map(rows.map((r) => [Number(r.id), r]));

  const items: NotificationGroup[] = [];
  for (const g of page) {
    const ids = parseIds(g.ids);
    const members = ids.map((id) => byId.get(id)).filter((r): r is MemberRow => !!r);
    const head = byId.get(Number(g.head));
    if (!head) continue;
    const seen = new Set<string>();
    const actors: NotificationActor[] = [];
    for (const r of members) {
      const name = r.actorCurrent ?? r.actorUsername;
      if (!name) continue;
      const key = r.actorId != null ? `id:${r.actorId}` : `@:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (actors.length < 3) {
        actors.push({ id: r.actorId ?? null, username: name, name: r.actorName ?? null, avatarUrl: r.actorAvatar ?? null });
      }
    }
    items.push({
      id: Number(head.id),
      ids,
      type: head.type,
      group: groupOf(head.type),
      text: groupedText(head.type, actors.map((a) => a.username), seen.size, head.text),
      href: ids.length > 1 ? (groupHref(head.type) ?? head.href) : head.href,
      read: Boolean(head.read),
      createdAt: head.createdAt,
      actors,
      actorCount: seen.size,
      total: Number(g.total),
    });
  }
  return { items, next };
}
