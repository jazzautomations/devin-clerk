import { describe, expect, it } from "vitest";
import db from "@/lib/db";
import { levelFor } from "@/lib/game";
import {
  awardXp,
  checkBadges,
  getCardRarity,
  getCardSupply,
  getMemberBadges,
  getMemberCard,
  getMemberCards,
  mintCard,
} from "@/lib/xp";
import { register } from "@/lib/registrations";

const HACK_ID = "hack-inova-alphaville-2026"; // seedado no bootstrap do db

function makeMember(clerkId: string, extra: Partial<{
  bio: string;
  headline: string;
  skills: string;
  role: string;
}> = {}): number {
  db.prepare(
    `INSERT INTO members (clerkId, username, email, bio, headline, skills, role)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    clerkId,
    `u_${clerkId}`,
    `${clerkId}@t.dev`,
    extra.bio ?? null,
    extra.headline ?? null,
    extra.skills ?? "[]",
    extra.role ?? "member",
  );
  return (
    db.prepare("SELECT id FROM members WHERE clerkId = ?").get(clerkId) as {
      id: number;
    }
  ).id;
}

describe("levelFor", () => {
  it("novato em 0xp e hacker a partir de 50", () => {
    expect(levelFor(0).level.name).toBe("novato");
    expect(levelFor(49).level.n).toBe(1);
    expect(levelFor(50).level.name).toBe("hacker");
    expect(levelFor(1000).level.name).toBe("lenda");
    expect(levelFor(99999).next).toBeNull();
  });

  it("progress dentro do nível é 0..1", () => {
    const { progress } = levelFor(100); // hacker: 50..150 → 50%
    expect(progress).toBeCloseTo(0.5);
  });
});

describe("awardXp", () => {
  it("acumula no membro", () => {
    const id = makeMember("xp1");
    awardXp(id, 50);
    awardXp(id, 10);
    const row = db.prepare("SELECT xp FROM members WHERE id=?").get(id) as {
      xp: number;
    };
    expect(row.xp).toBe(60);
  });
});

describe("cartinhas", () => {
  it("serial é incremental e mint é idempotente", () => {
    const a = makeMember("cardA");
    const b = makeMember("cardB");
    expect(mintCard(a, HACK_ID)).toBe(1);
    expect(mintCard(b, HACK_ID)).toBe(2);
    expect(mintCard(a, HACK_ID)).toBeNull();
    expect(getCardSupply(HACK_ID)).toBe(2);
    expect(getMemberCard(a, HACK_ID)?.serial).toBe(1);
  });

  it("raridade das edições hack inova é curada", () => {
    expect(getCardRarity("hack-inova-alphaville-2026")).toBe("raro");
    expect(getCardRarity("hack-inova-unifacens-2026")).toBe("lendario");
    expect(getCardRarity("hack-inova-puc-saude-2026")).toBe("epico");
  });

  it("evento externo minta como comum sob demanda", () => {
    const a = makeMember("cardC");
    db.prepare(
      `INSERT INTO hackathons (id, name, organizer, startsAt, format, registrationUrl, tags)
       VALUES ('ext-1','Ext','Org','2099-01-01','online','https://x.dev','[]')`,
    ).run();
    mintCard(a, "ext-1");
    expect(getCardRarity("ext-1")).toBe("comum");
  });

  it("getMemberCards retorna a coleção com dados da edição", () => {
    const a = makeMember("cardD");
    mintCard(a, HACK_ID);
    const cards = getMemberCards(a);
    expect(cards).toHaveLength(1);
    expect(cards[0].name).toContain("Hack Inova");
    expect(cards[0].serial).toBeGreaterThan(0);
  });
});

describe("badges", () => {
  it("membro novo ganha pioneiro (id <= 50)", () => {
    const id = makeMember("b1");
    const badges = checkBadges(id).map((b) => b.id);
    expect(badges).toContain("pioneiro");
    // segunda checagem não duplica
    expect(checkBadges(id)).toHaveLength(0);
    expect(getMemberBadges(id).map((b) => b.id)).toContain("pioneiro");
  });

  it("debut quando registra; veterano aos 3", () => {
    const id = makeMember("b2");
    register(id, HACK_ID);
    expect(checkBadges(id).map((b) => b.id)).toContain("debut");
    db.prepare(
      `INSERT INTO hackathons (id, name, organizer, startsAt, format, registrationUrl, tags)
       VALUES ('h2','H2','O','2099-01-01','online','https://x','[]'),
              ('h3','H3','O','2099-01-01','online','https://x','[]')`,
    ).run();
    register(id, "h2");
    register(id, "h3");
    expect(checkBadges(id).map((b) => b.id)).toContain("veterano");
  });

  it("identidade exige bio+headline+skills e paga +25xp uma vez", () => {
    const id = makeMember("b3", {
      bio: "dev",
      headline: "eng",
      skills: '["ts"]',
    });
    const badges = checkBadges(id).map((b) => b.id);
    expect(badges).toContain("identidade");
    const xp1 = (db.prepare("SELECT xp FROM members WHERE id=?").get(id) as { xp: number }).xp;
    expect(xp1).toBe(25);
    checkBadges(id);
    const xp2 = (db.prepare("SELECT xp FROM members WHERE id=?").get(id) as { xp: number }).xp;
    expect(xp2).toBe(25);
  });

  it("admin ganha organizador", () => {
    const id = makeMember("b4", { role: "admin" });
    expect(checkBadges(id).map((b) => b.id)).toContain("organizador");
  });
});
