import db from "@/lib/db";

// schema próprio (idempotente) — não edita lib/db.ts; pattern de lib/deploys.ts
db.exec(`CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memberId INTEGER NOT NULL REFERENCES members(id),
  actorUsername TEXT,
  type TEXT NOT NULL,
  text TEXT NOT NULL,
  href TEXT,
  read INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT NOT NULL DEFAULT (datetime('now'))
)`);
db.exec(
  "CREATE INDEX IF NOT EXISTS idx_notifications_member_read ON notifications(memberId, read)",
);

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
export function notify(
  memberId: number,
  opts: {
    type: string;
    actorUsername?: string;
    text: string;
    href?: string;
  },
): void {
  if (opts.actorUsername) {
    const target = db
      .prepare("SELECT username FROM members WHERE id = ?")
      .get(memberId) as { username: string } | undefined;
    if (target?.username === opts.actorUsername) return;
  }
  db.prepare(
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

export function listNotifications(
  memberId: number,
  limit = 50,
): Notification[] {
  const rows = db
    .prepare(
      "SELECT * FROM notifications WHERE memberId = ? ORDER BY id DESC LIMIT ?",
    )
    .all(memberId, limit) as NotificationRow[];
  return rows.map(toNotification);
}

export function unreadCount(memberId: number): number {
  return (
    db
      .prepare(
        "SELECT COUNT(*) n FROM notifications WHERE memberId = ? AND read = 0",
      )
      .get(memberId) as { n: number }
  ).n;
}

export function markAllRead(memberId: number): void {
  db.prepare("UPDATE notifications SET read = 1 WHERE memberId = ?").run(
    memberId,
  );
}

/** escopo por memberId — marcar a dos outros é no-op silencioso */
export function markRead(id: number, memberId: number): void {
  db.prepare(
    "UPDATE notifications SET read = 1 WHERE id = ? AND memberId = ?",
  ).run(id, memberId);
}
