import { describe, expect, it, vi } from "vitest";
import "@/lib/submissions"; // schema próprio: event_submissions no :memory:

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: null })),
  currentUser: vi.fn(async () => null),
}));

const req = (method: string, body?: unknown) =>
  new Request("http://t", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

describe("guardas de curadoria — deslogado recebe 401 JSON", () => {
  it("GET /api/submissions", async () => {
    const { GET } = await import("@/app/api/submissions/route");
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("POST /api/admin/submissions/[id]", async () => {
    const { POST } = await import("@/app/api/admin/submissions/[id]/route");
    const res = await POST(req("POST", { action: "approve" }), {
      params: Promise.resolve({ id: "1" }),
    });
    expect(res.status).toBe(401);
  });
});
