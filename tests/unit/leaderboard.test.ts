import { describe, expect, it } from "vitest";
import db from "@/lib/db";
import { listLeaderboard } from "@/lib/members";

const HACK_ID = "hack-inova-alphaville-2026"; // seedado no bootstrap do db

function makeMember(
  clerkId: string,
  extra: Partial<{ xp: number; username: string; createdAt: string }> = {},
): number {
  db.prepare(
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
    db.prepare("SELECT id FROM members WHERE clerkId = ?").get(clerkId) as {
      id: number;
    }
  ).id;
}

describe("listLeaderboard", () => {
  it("ordena por xp desc e desempata por username asc", () => {
    makeMember("lb-z", { xp: 100, username: "zara" });
    makeMember("lb-top", { xp: 300, username: "bia" });
    makeMember("lb-a", { xp: 100, username: "ana" });
    const usernames = listLeaderboard().map((m) => m.username);
    expect(usernames.indexOf("bia")).toBeLessThan(usernames.indexOf("ana"));
    // empate em 100xp: ana vem antes de zara por username
    expect(usernames.indexOf("ana")).toBeLessThan(usernames.indexOf("zara"));
  });

  it("carrega contagens de badges, campanhas e cartinhas", () => {
    const id = makeMember("lb-count", { xp: 10 });
    db.prepare(
      "INSERT INTO member_badges (memberId, badgeId) VALUES (?, 'pioneiro')",
    ).run(id);
    db.prepare(
      "INSERT INTO member_badges (memberId, badgeId) VALUES (?, 'debut')",
    ).run(id);
    db.prepare(
      "INSERT INTO registrations (memberId, hackathonId) VALUES (?, ?)",
    ).run(id, HACK_ID);
    db.prepare(
      "INSERT INTO member_cards (memberId, hackathonId, serial) VALUES (?, ?, ?)",
    ).run(id, HACK_ID, 1);
    const m = listLeaderboard().find((x) => x.id === id)!;
    expect(m.badges).toBe(2);
    expect(m.campaigns).toBe(1);
    expect(m.cards).toBe(1);
  });

  it("sort=recent põe quem entrou por último no topo", () => {
    makeMember("lb-old", { createdAt: "2020-01-01 00:00:00" });
    makeMember("lb-new", { createdAt: "2030-01-01 00:00:00" });
    const usernames = listLeaderboard("recent").map((m) => m.username);
    expect(usernames[0]).toBe("u_lb-new");
    expect(usernames.indexOf("u_lb-new")).toBeLessThan(
      usernames.indexOf("u_lb-old"),
    );
  });

  it("respeita o limite", () => {
    expect(listLeaderboard("xp", 2)).toHaveLength(2);
  });
});
