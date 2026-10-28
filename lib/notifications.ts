import db from "@/lib/db";

export type Notification = {
  id: number;
  memberId: number;
  actorUsername: string | null;
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
 * histórico); actorId guarda quem é a pessoa, pro filtro de silêncio e
 * bloqueio sobreviver à troca de @. Nunca notifica a si mesmo: se o ator é
 * o destinatário, é skip silencioso — curtir o próprio post não é novidade.
 */
export async function notify(
  memberId: number,
  opts: {
    type: string;
    actorUsername?: string;
    text: string;
    href?: string;
  },
): Promise<void> {
  let actorId: number | null = null;
  if (opts.actorUsername) {
    const actor = await db
      .prepare("SELECT id FROM members WHERE username = ?")
      .get<{ id: number }>(opts.actorUsername);
    if (actor?.id === memberId) return;
    actorId = actor?.id ?? null;
  }
  await db.prepare(
    `INSERT INTO notifications (memberId, actorUsername, actorId, type, text, href)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    memberId,
    opts.actorUsername ?? null,
    actorId,
    opts.type,
    opts.text,
    opts.href ?? null,
  );
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
