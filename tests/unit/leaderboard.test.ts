import { describe, expect, it } from "vitest";
import db from "@/lib/db";
import { listLeaderboard } from "@/lib/members";

const HACK_ID = "hack-inova-alphaville-2026"; // seedado no bootstrap do db

async function makeMember(
  clerkId: string,
  extra: Partial<{ xp: number; username: string; createdAt: string }> = {},
): Promise<number> {
  await db.prepare(
    `INSERT INTO members (clerkId, username, email, xp, createdAt)
     VALUES (?, ?, ?, ?, COALESCE(?, datetime('now')))`,
  ).run(
    clerkId,
    extra.username ?? `u_${clerkId}`,
    `${clerkId}@t.dev`,
    extra.xp ?? 0,
    extra.createdAt ?? null,
  );
  return (
    await db.prepare("SELECT id FROM members WHERE clerkId = ?").get(clerkId) as {
      id: number;
    }
  ).id;
}

describe("listLeaderboard", () => {
  it("ordena por xp desc e desempata por username asc", async () => {
    await makeMember("lb-z", { xp: 100, username: "zara" });
    await makeMember("lb-top", { xp: 300, username: "bia" });
    await makeMember("lb-a", { xp: 100, username: "ana" });
    const usernames = (await listLeaderboard()).map((m) => m.username);
    expect(usernames.indexOf("bia")).toBeLessThan(usernames.indexOf("ana"));
    // empate em 100xp: ana vem antes de zara por username
    expect(usernames.indexOf("ana")).toBeLessThan(usernames.indexOf("zara"));
  });

  it("carrega contagens de badges, campanhas e cartinhas", async () => {
    const id = await makeMember("lb-count", { xp: 10 });
    await db.prepare(
      "INSERT INTO member_badges (memberId, badgeId) VALUES (?, 'pioneiro')",
    ).run(id);
    await db.prepare(
      "INSERT INTO member_badges (memberId, badgeId) VALUES (?, 'debut')",
    ).run(id);
    await db.prepare(
      "INSERT INTO registrations (memberId, hackathonId) VALUES (?, ?)",
    ).run(id, HACK_ID);
    await db.prepare(
      "INSERT INTO member_cards (memberId, hackathonId, serial) VALUES (?, ?, ?)",
    ).run(id, HACK_ID, 1);
    const m = (await listLeaderboard()).find((x) => x.id === id)!;
    expect(m.badges).toBe(2);
    expect(m.campaigns).toBe(1);
    expect(m.cards).toBe(1);
  });

  it("badge aposentado (criador, influente) não entra no contador", async () => {
    const id = await makeMember("lb-retired", { xp: 5 });
    for (const b of ["debut", "criador", "influente"]) {
      await db.prepare(
        "INSERT INTO member_badges (memberId, badgeId) VALUES (?, ?)",
      ).run(id, b);
    }
    const m = (await listLeaderboard()).find((x) => x.id === id)!;
    expect(m.badges).toBe(1);
  });

  it("sort=recent põe quem entrou por último no topo", async () => {
    await makeMember("lb-old", { createdAt: "2020-01-01 00:00:00" });
    await makeMember("lb-new", { createdAt: "2030-01-01 00:00:00" });
    const usernames = (await listLeaderboard("recent")).map((m) => m.username);
    expect(usernames[0]).toBe("u_lb-new");
    expect(usernames.indexOf("u_lb-new")).toBeLessThan(
      usernames.indexOf("u_lb-old"),
    );
  });

  it("respeita o limite", async () => {
    expect(await listLeaderboard("xp", 2)).toHaveLength(2);
  });
});
