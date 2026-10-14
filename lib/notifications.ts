import db from "@/lib/db";

export type Notification = {
  id: number;
  memberId: number;
  actorUsername: string | null;
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
 * histórico, não FK). Nunca notifica a si mesmo: se o ator é o destinatário,
 * é skip silencioso — curtir o próprio post não é novidade.
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
  if (opts.actorUsername) {
    const target = await db
      .prepare("SELECT username FROM members WHERE id = ?")
      .get(memberId) as { username: string } | undefined;
    if (target?.username === opts.actorUsername) return;
  }
  await db.prepare(
    `INSERT INTO notifications (memberId, actorUsername, type, text, href)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    memberId,
    opts.actorUsername ?? null,
    opts.type,
    opts.text,
    opts.href ?? null,
  );
}

export async function listNotifications(
  memberId: number,
  limit = 50,
): Promise<Notification[]> {
  const rows = await db
    .prepare(
      "SELECT * FROM notifications WHERE memberId = ? ORDER BY id DESC LIMIT ?",
    )
    .all(memberId, limit) as NotificationRow[];
  return rows.map(toNotification);
}

export async function unreadCount(memberId: number): Promise<number> {
  return (
    await db
      .prepare(
        "SELECT COUNT(*) n FROM notifications WHERE memberId = ? AND read = 0",
      )
      .get(memberId) as { n: number }
  ).n;
}

export async function markAllRead(memberId: number): Promise<void> {
  await db.prepare("UPDATE notifications SET read = 1 WHERE memberId = ?").run(
    memberId,
  );
}

/** escopo por memberId — marcar a dos outros é no-op silencioso */
export async function markRead(id: number, memberId: number): Promise<void> {
  await db.prepare(
    "UPDATE notifications SET read = 1 WHERE id = ? AND memberId = ?",
  ).run(id, memberId);
}
