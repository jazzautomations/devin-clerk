import db from "@/lib/db";
import { BADGES, XP, type Badge, type Rarity } from "@/lib/game";

// spec 032 — badges de inscrição (debut/veterano) contam só status
// 'approved': pedido pendente não é campanha. Guarda própria do ALTER
// (dona: lib/registrations) pra quem importa xp.ts direto.

export async function awardXp(memberId: number, amount: number): Promise<void> {
  await db.prepare("UPDATE members SET xp = xp + ? WHERE id = ?").run(
    amount,
    memberId,
  );
}

export async function getMemberBadges(memberId: number): Promise<Badge[]> {
  const rows = await db
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

export async function getMemberCards(memberId: number): Promise<CollectedCard[]> {
  return await db
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

export async function getCardSupply(hackathonId: string): Promise<number> {
  return (
    await db
      .prepare("SELECT COUNT(*) n FROM member_cards WHERE hackathonId = ?")
      .get(hackathonId) as { n: number }
  ).n;
}

export async function getMemberCard(
  memberId: number,
  hackathonId: string,
): Promise<{ serial: number } | null> {
  return (
    (await db
      .prepare(
        "SELECT serial FROM member_cards WHERE memberId = ? AND hackathonId = ?",
      )
      .get(memberId, hackathonId) as { serial: number } | undefined) ?? null
  );
}

export async function getCardRarity(hackathonId: string): Promise<Rarity> {
  const row = await db
    .prepare("SELECT rarity FROM cards WHERE hackathonId = ?")
    .get(hackathonId) as { rarity: Rarity } | undefined;
  return row?.rarity ?? "comum";
}

// minta a cartinha da edição pro membro — serial incremental, prova de presença
export async function mintCard(memberId: number, hackathonId: string): Promise<number | null> {
  await db.prepare(
    "INSERT OR IGNORE INTO cards (hackathonId, rarity) VALUES (?, 'comum')",
  ).run(hackathonId);
  const already = await getMemberCard(memberId, hackathonId);
  if (already) return null;
  const serial = await getCardSupply(hackathonId) + 1;
  await db.prepare(
    "INSERT OR IGNORE INTO member_cards (memberId, hackathonId, serial) VALUES (?, ?, ?)",
  ).run(memberId, hackathonId, serial);
  return serial;
}

// avalia e concede badges pelas estatísticas atuais — retorna as recém-ganhas
export async function checkBadges(memberId: number): Promise<Badge[]> {
  const m = await db
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

  const count = async (sql: string) =>
    (await db.prepare(sql).get(memberId) as { n: number }).n;
  const stats = {
    regs: await count(
      `SELECT COUNT(*) n FROM registrations
       WHERE memberId = ? AND status = 'approved'`,
    ),
    posts: await count("SELECT COUNT(*) n FROM posts WHERE memberId = ?"),
    likesReceived: await count(
      `SELECT COUNT(*) n FROM likes l
       JOIN posts p ON p.id = l.postId WHERE p.memberId = ?`,
    ),
    cards: await count("SELECT COUNT(*) n FROM member_cards WHERE memberId = ?"),
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
    const res = await insert.run(memberId, id);
    if (res.changes > 0) {
      fresh.push(BADGES[id]);
      if (id === "identidade") await awardXp(memberId, XP.identidade);
    }
  }
  return fresh;
}
