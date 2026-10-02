import db from "@/lib/db";

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
): { username: string; name: string | null; createdAt: string }[] {
  return db
    .prepare(
      `SELECT m.username, m.name, r.createdAt
       FROM registrations r JOIN members m ON m.id = r.memberId
       WHERE r.hackathonId = ? ORDER BY r.createdAt`,
    )
    .all(hackathonId) as { username: string; name: string | null; createdAt: string }[];
}
