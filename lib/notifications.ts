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

/**
 * Cria uma notificação pro membro. actorUsername é texto congelado (recado
 * histórico, não FK); actorId é quem causou, por id. Sem actorId, o id é
 * resolvido pelo @ no momento do envio. Nunca notifica a si mesmo: se o ator
 * é o destinatário, é skip silencioso — curtir o próprio post não é novidade.
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
  await db.prepare(
    `INSERT INTO notifications (memberId, actorUsername, actorId, type, text, href)
     VALUES (?, ?, COALESCE(?::int, (SELECT id FROM members WHERE username = ?::text)), ?, ?, ?)`,
  ).run(
    memberId,
    opts.actorUsername ?? null,
    opts.actorId ?? null,
    opts.actorUsername ?? null,
    opts.type,
    opts.text,
    opts.href ?? null,
  );
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

export async function unreadCount(memberId: number): Promise<number> {
  return (
    await db
      .prepare(
        `SELECT COUNT(*) n FROM notifications WHERE memberId = @me AND read = 0 AND ${NOT_HIDDEN}`,
      )
      .get({ me: memberId }) as { n: number }
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
export async function openNotification(id: number, memberId: number): Promise<string | null> {
  const row = await db
    .prepare("UPDATE notifications SET read = 1 WHERE id = ? AND memberId = ? RETURNING href")
    .get<{ href: string | null }>(id, memberId);
  return row ? safeHref(row.href) : null;
}

/** escopo por memberId — marcar a dos outros é no-op silencioso */
export async function markRead(id: number, memberId: number): Promise<void> {
  await db.prepare(
    "UPDATE notifications SET read = 1 WHERE id = ? AND memberId = ?",
  ).run(id, memberId);
}
