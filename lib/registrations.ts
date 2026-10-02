import db from "@/lib/db";

// avatarUrl é coluna de lib/members — garante o ALTER aqui pra quem importa
// este módulo sem passar por members.ts; pattern idempotente PRAGMA + ADD COLUMN
if (
  !(db.prepare("PRAGMA table_info(members)").all() as { name: string }[]).some(
    (c) => c.name === "avatarUrl",
  )
) {
  db.exec("ALTER TABLE members ADD COLUMN avatarUrl TEXT");
}

export function register(memberId: number, hackathonId: string): void {
  db.prepare(
    `INSERT OR IGNORE INTO registrations (memberId, hackathonId) VALUES (?, ?)`,
  ).run(memberId, hackathonId);
}

export function unregister(memberId: number, hackathonId: string): void {
  db.prepare(
    `DELETE FROM registrations WHERE memberId = ? AND hackathonId = ?`,
  ).run(memberId, hackathonId);
}

export function getRegistrationIds(memberId: number): string[] {
  const rows = db
    .prepare("SELECT hackathonId FROM registrations WHERE memberId = ?")
    .all(memberId) as { hackathonId: string }[];
  return rows.map((r) => r.hackathonId);
}

export function getRegistrationsForMember(memberId: number): string[] {
  return getRegistrationIds(memberId);
}

export function getRegistrationsByHackathon(
  hackathonId: string,
): {
  username: string;
  name: string | null;
  avatarUrl: string | null;
  createdAt: string;
}[] {
  return db
    .prepare(
      `SELECT m.username, m.name, m.avatarUrl, r.createdAt
       FROM registrations r JOIN members m ON m.id = r.memberId
       WHERE r.hackathonId = ? ORDER BY r.createdAt`,
    )
    .all(hackathonId) as {
    username: string;
    name: string | null;
    avatarUrl: string | null;
    createdAt: string;
  }[];
}

// versão operacional (admin): inclui e-mail — nunca usar em rota pública
export function listRegistrants(
  hackathonId: string,
): { username: string; name: string | null; email: string; createdAt: string }[] {
  return db
    .prepare(
      `SELECT m.username, m.name, m.email, r.createdAt
       FROM registrations r JOIN members m ON m.id = r.memberId
       WHERE r.hackathonId = ? ORDER BY r.createdAt`,
    )
    .all(hackathonId) as {
    username: string;
    name: string | null;
    email: string;
    createdAt: string;
  }[];
}
