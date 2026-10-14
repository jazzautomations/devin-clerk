import { describe, expect, it, vi } from "vitest";
import db from "@/lib/db";

const clerk = vi.hoisted(() => ({ uid: "clerk_un" as string | null }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: clerk.uid })),
  currentUser: vi.fn(async () => null),
}));

const post = (body: unknown) =>
  new Request("http://t/api/members/me/username", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /api/members/me/username (frente N #8)", () => {
  it("401 deslogado; 200 na primeira troca; 409 na segunda; 400 formato", async () => {
    const { POST } = await import("@/app/api/members/me/username/route");
    clerk.uid = null;
    expect((await POST(post({ username: "novo_nome" }))).status).toBe(401);

    clerk.uid = "clerk_un";
    await db.prepare("INSERT INTO members (clerkId, username, email) VALUES ('clerk_un', 'hacker7', 'un@t.dev')").run();
    expect((await POST(post({ username: "x" }))).status).toBe(400);
    const ok = await POST(post({ username: "bruna_dev" }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ username: "bruna_dev", old: "hacker7" });
    const again = await POST(post({ username: "bruna_2" }));
    expect(again.status).toBe(409);
    expect((await again.json()).error).toMatch(/uma vez/);
  });
});
