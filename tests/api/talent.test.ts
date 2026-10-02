import { describe, expect, it, vi } from "vitest";
import db from "@/lib/db";

const clerk = vi.hoisted(() => ({ uid: "clerk_talent" as string | null }));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: clerk.uid })),
  currentUser: vi.fn(async () => null),
}));

function memberId(clerkId: string): number {
  db.prepare(
    "INSERT OR IGNORE INTO members (clerkId, username, email) VALUES (?, ?, ?)",
  ).run(clerkId, `u_${clerkId}`, `${clerkId}@t.dev`);
  return (
    db.prepare("SELECT id FROM members WHERE clerkId = ?").get(clerkId) as {
      id: number;
    }
  ).id;
}

const openToOf = (id: number) =>
  (
    db.prepare("SELECT openTo FROM members WHERE id = ?").get(id) as {
      openTo: string | null;
    }
  ).openTo;

const patch = (body: unknown) =>
  new Request("http://t", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("PATCH /api/members/me — openTo (spec 014)", () => {
  it("aceita array da whitelist e persiste", async () => {
    clerk.uid = "clerk_talent";
    const mid = memberId("clerk_talent");
    const { PATCH } = await import("@/app/api/members/me/route");
    const res = await PATCH(patch({ openTo: ["trampo", "mentoria"] }));
    expect(res.status).toBe(200);
    expect(openToOf(mid)).toBe("trampo,mentoria");
  });

  it("400 — valor fora da whitelist", async () => {
    clerk.uid = "clerk_talent";
    const { PATCH } = await import("@/app/api/members/me/route");
    for (const bad of [
      { openTo: ["famoso"] },
      { openTo: ["trampo", "vip"] },
      { openTo: "trampo" },
      { openTo: [42] },
      { openTo: null },
    ]) {
      expect((await PATCH(patch(bad))).status).toBe(400);
    }
  });

  it("openTo ausente no PATCH preserva a coluna", async () => {
    clerk.uid = "clerk_talent2";
    const mid = memberId("clerk_talent2");
    const { PATCH } = await import("@/app/api/members/me/route");
    await PATCH(patch({ openTo: ["freela"] }));
    expect(openToOf(mid)).toBe("freela");
    const res = await PATCH(patch({ bio: "mexeu só na bio" }));
    expect(res.status).toBe(200);
    expect(openToOf(mid)).toBe("freela");
  });

  it("[] limpa o opt-in — vira NULL e some de /talento", async () => {
    clerk.uid = "clerk_talent3";
    const mid = memberId("clerk_talent3");
    const { PATCH } = await import("@/app/api/members/me/route");
    await PATCH(patch({ openTo: ["trampo"] }));
    expect(openToOf(mid)).toBe("trampo");
    const res = await PATCH(patch({ openTo: [] }));
    expect(res.status).toBe(200);
    expect(openToOf(mid)).toBeNull();
  });

  it("401 deslogado", async () => {
    clerk.uid = null;
    const { PATCH } = await import("@/app/api/members/me/route");
    expect((await PATCH(patch({ openTo: ["trampo"] }))).status).toBe(401);
  });
});
