import { describe, expect, it, vi } from "vitest";
import db from "@/lib/db";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: "clerk_notadmin" })),
  currentUser: vi.fn(async () => null),
}));

db.prepare(
  "INSERT OR IGNORE INTO members (clerkId, username, email, role) VALUES ('clerk_notadmin','notadm','n@t.dev','member')",
).run();

const req = (method: string, body?: unknown) =>
  new Request("http://t", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

describe("guardas de admin — sponsors respondem 403 pra não-admin", () => {
  it("POST /api/admin/sponsors", async () => {
    const { POST } = await import("@/app/api/admin/sponsors/route");
    const res = await POST(req("POST", { name: "X" }));
    expect(res.status).toBe(403);
  });

  it("GET /api/admin/sponsors", async () => {
    const { GET } = await import("@/app/api/admin/sponsors/route");
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("PATCH /api/admin/sponsors/[id]", async () => {
    const { PATCH } = await import("@/app/api/admin/sponsors/[id]/route");
    const res = await PATCH(req("PATCH", { active: false }), {
      params: Promise.resolve({ id: "x" }),
    });
    expect(res.status).toBe(403);
  });
});
