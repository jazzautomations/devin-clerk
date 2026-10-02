import { describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import "@/lib/submissions"; // schema próprio: event_submissions no :memory:

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: "clerk_notadmin" })),
  currentUser: vi.fn(async () => null),
}));

db.prepare(
  "INSERT OR IGNORE INTO members (clerkId, username, email, role) VALUES ('clerk_notadmin','notadm_sub','n@t.dev','member')",
).run();

const req = (method: string, body?: unknown) =>
  new Request("http://t", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

describe("guardas de curadoria — não-admin recebe 403", () => {
  it("GET /api/submissions", async () => {
    const { GET } = await import("@/app/api/submissions/route");
    const res = await GET();
    expect(res.status).toBe(403);
  });

  it("POST /api/admin/submissions/[id]", async () => {
    const { POST } = await import("@/app/api/admin/submissions/[id]/route");
    const res = await POST(req("POST", { action: "approve" }), {
      params: Promise.resolve({ id: "1" }),
    });
    expect(res.status).toBe(403);
  });
});
