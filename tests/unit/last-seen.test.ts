import { describe, expect, it, vi } from "vitest";
import db from "@/lib/db";

// members.lastSeenAt (migration 031): o login grava "agora" no máximo 1 vez
// por hora, com um UPDATE condicional.

const clerk = vi.hoisted(() => ({ userId: "user_lastseen_1" as string | null }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: clerk.userId })),
  currentUser: vi.fn(async () => ({
    firstName: "Lia",
    lastName: null,
    primaryEmailAddress: { emailAddress: "lia.lastseen@t.dev" },
    imageUrl: null,
  })),
}));

import { currentMember, touchLastSeen } from "@/lib/session";

const seen = async (id: number) =>
  (await db.prepare("SELECT lastSeenAt FROM members WHERE id = ?").get<{ lastSeenAt: string | null }>(id))!.lastSeenAt;

describe("lastSeenAt", () => {
  it("login grava; de novo dentro de 1 hora não regrava; depois de 1 hora regrava", async () => {
    const m = await currentMember();
    expect(m).not.toBeNull();
    expect(await seen(m!.id)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

    // 50 min atrás: dentro da hora, não mexe
    await db.prepare("UPDATE members SET lastSeenAt = sqlite_now('-50 minutes') WHERE id = ?").run(m!.id);
    const recent = await seen(m!.id);
    expect(await touchLastSeen(m!.id)).toBe(false);
    await currentMember();
    expect(await seen(m!.id)).toBe(recent);

    // 61 min atrás: o próximo acesso regrava, e só ele
    await db.prepare("UPDATE members SET lastSeenAt = sqlite_now('-61 minutes') WHERE id = ?").run(m!.id);
    await currentMember();
    expect(await seen(m!.id)).not.toBe(recent);
    expect(await touchLastSeen(m!.id)).toBe(false);
  });

  it("sem valor salvo grava na hora", async () => {
    const r = await db
      .prepare("INSERT INTO members (clerkId, username, email) VALUES ('c_ls2', 'u_ls2', 'ls2@t.dev') RETURNING id")
      .get<{ id: number }>();
    expect(await seen(r!.id)).toBeNull();
    expect(await touchLastSeen(r!.id)).toBe(true);
    expect(await seen(r!.id)).not.toBeNull();
  });
});
