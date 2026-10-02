import db, { ensureColumn } from "@/lib/db";
import { BADGES, XP, type Badge, type Rarity } from "@/lib/game";

// spec 032 — badges de inscrição (debut/veterano) contam só status
// 'approved': pedido pendente não é campanha. Guarda própria do ALTER
// (dona: lib/registrations) pra quem importa xp.ts direto.
ensureColumn(
  "registrations",
  "status",
  "status TEXT NOT NULL DEFAULT 'approved'",
);

export function awardXp(memberId: number, amount: number): void {
  db.prepare("UPDATE members SET xp = xp + ? WHERE id = ?").run(
    amount,
    memberId,
  );
}

export function getMemberBadges(memberId: number): Badge[] {
  const rows = db
    .prepare(
      "SELECT badgeId FROM member_badges WHERE memberId = ? ORDER BY awardedAt",
    )
    .all(memberId) as { badgeId: string }[];
  return rows.map((r) => BADGES[r.badgeId]).filter(Boolean);
}

export type CollectedCard = {
  hackathonId: string;
  name: string;
  startsAt: string;
  location: string | null;
  rarity: Rarity;
  serial: number;
  awardedAt: string;
};

export function getMemberCards(memberId: number): CollectedCard[] {
  return db
    .prepare(
      `SELECT mc.hackathonId, h.name, h.startsAt, h.location,
              c.rarity, mc.serial, mc.awardedAt
       FROM member_cards mc
       JOIN hackathons h ON h.id = mc.hackathonId
       JOIN cards c ON c.hackathonId = mc.hackathonId
       WHERE mc.memberId = ?
       ORDER BY mc.awardedAt DESC`,
    )
    .all(memberId) as CollectedCard[];
}

export function getCardSupply(hackathonId: string): number {
  return (
    db
      .prepare("SELECT COUNT(*) n FROM member_cards WHERE hackathonId = ?")
      .get(hackathonId) as { n: number }
  ).n;
}

export function getMemberCard(
  memberId: number,
  hackathonId: string,
): { serial: number } | null {
  return (
    (db
      .prepare(
        "SELECT serial FROM member_cards WHERE memberId = ? AND hackathonId = ?",
      )
      .get(memberId, hackathonId) as { serial: number } | undefined) ?? null
  );
}

export function getCardRarity(hackathonId: string): Rarity {
  const row = db
    .prepare("SELECT rarity FROM cards WHERE hackathonId = ?")
    .get(hackathonId) as { rarity: Rarity } | undefined;
  return row?.rarity ?? "comum";
}

// minta a cartinha da edição pro membro — serial incremental, prova de presença
export function mintCard(memberId: number, hackathonId: string): number | null {
  db.prepare(
    "INSERT OR IGNORE INTO cards (hackathonId, rarity) VALUES (?, 'comum')",
  ).run(hackathonId);
  const already = getMemberCard(memberId, hackathonId);
  if (already) return null;
  const serial = getCardSupply(hackathonId) + 1;
  db.prepare(
    "INSERT OR IGNORE INTO member_cards (memberId, hackathonId, serial) VALUES (?, ?, ?)",
  ).run(memberId, hackathonId, serial);
  return serial;
}

// avalia e concede badges pelas estatísticas atuais — retorna as recém-ganhas
export function checkBadges(memberId: number): Badge[] {
  const m = db
    .prepare(
      "SELECT id, role, bio, headline, skills FROM members WHERE id = ?",
    )
    .get(memberId) as {
    id: number;
    role: string;
    bio: string | null;
    headline: string | null;
    skills: string;
  };
  if (!m) return [];

  const count = (sql: string) =>
    (db.prepare(sql).get(memberId) as { n: number }).n;
  const stats = {
    regs: count(
      `SELECT COUNT(*) n FROM registrations
       WHERE memberId = ? AND status = 'approved'`,
    ),
    posts: count("SELECT COUNT(*) n FROM posts WHERE memberId = ?"),
    likesReceived: count(
      `SELECT COUNT(*) n FROM likes l
       JOIN posts p ON p.id = l.postId WHERE p.memberId = ?`,
    ),
    cards: count("SELECT COUNT(*) n FROM member_cards WHERE memberId = ?"),
  };

  const earned: string[] = [];
  if (m.id <= 50) earned.push("pioneiro");
  if (m.bio && m.headline && JSON.parse(m.skills || "[]").length > 0)
    earned.push("identidade");
  if (stats.regs >= 1) earned.push("debut");
  if (stats.regs >= 3) earned.push("veterano");
  if (stats.posts >= 5) earned.push("criador");
  if (stats.likesReceived >= 10) earned.push("influente");
  if (stats.cards >= 5) earned.push("colecionador");
  if (m.role === "admin") earned.push("organizador");

  const insert = db.prepare(
    "INSERT OR IGNORE INTO member_badges (memberId, badgeId) VALUES (?, ?)",
  );
  const fresh: Badge[] = [];
  for (const id of earned) {
    const res = insert.run(memberId, id);
    if (res.changes > 0) {
      fresh.push(BADGES[id]);
      if (id === "identidade") awardXp(memberId, XP.identidade);
    }
  }
  return fresh;
}
