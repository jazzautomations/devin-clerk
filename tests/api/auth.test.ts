import { describe, expect, it, vi } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: null })),
  currentUser: vi.fn(async () => null),
}));

const req = (method: string, body?: unknown) =>
  new Request("http://t", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

describe("rotas autenticadas respondem 401 deslogado", () => {
  it("POST /api/posts", async () => {
    const { POST } = await import("@/app/api/posts/route");
    const res = await POST(req("POST", { body: "oi" }));
    expect(res.status).toBe(401);
  });

  it("GET /api/posts é pública mesmo deslogado", async () => {
    const { GET } = await import("@/app/api/posts/route");
    const res = await GET();
    expect(res.status).toBe(200);
  });

  it("POST register", async () => {
    const { POST } = await import("@/app/api/hackathons/[id]/register/route");
    const res = await POST(req("POST"), {
      params: Promise.resolve({ id: "hack-inova-alphaville-2026" }),
    });
    expect(res.status).toBe(401);
  });

  it("POST like", async () => {
    const { POST } = await import("@/app/api/posts/[id]/like/route");
    const res = await POST(req("POST"), {
      params: Promise.resolve({ id: "1" }),
    });
    expect(res.status).toBe(401);
  });

  it("PATCH /api/members/me", async () => {
    const { PATCH } = await import("@/app/api/members/me/route");
    const res = await PATCH(req("PATCH", { bio: "x" }));
    expect(res.status).toBe(401);
  });

  it("PATCH /api/admin/hackathons/[id]", async () => {
    const { PATCH } = await import("@/app/api/admin/hackathons/[id]/route");
    const res = await PATCH(req("PATCH", { name: "x" }), {
      params: Promise.resolve({ id: "hack-inova-alphaville-2026" }),
    });
    expect(res.status).toBe(401);
  });

  it("GET /api/admin/hackathons/[id]/registrations", async () => {
    const { GET } = await import(
      "@/app/api/admin/hackathons/[id]/registrations/route"
    );
    const res = await GET(req("GET"), {
      params: Promise.resolve({ id: "hack-inova-alphaville-2026" }),
    });
    expect(res.status).toBe(401);
  });

  it("GET /api/admin/subscribers", async () => {
    const { GET } = await import("@/app/api/admin/subscribers/route");
    const res = await GET(req("GET"));
    expect(res.status).toBe(401);
  });

  it("POST /api/admin/hackathons/[id]/challenges", async () => {
    const { POST } = await import(
      "@/app/api/admin/hackathons/[id]/challenges/route"
    );
    const res = await POST(req("POST", { sponsor: "S", title: "T" }), {
      params: Promise.resolve({ id: "hack-inova-puc-saude-2026" }),
    });
    expect(res.status).toBe(401);
  });

  it("PATCH /api/admin/challenges/[challengeId]", async () => {
    const { PATCH } = await import(
      "@/app/api/admin/challenges/[challengeId]/route"
    );
    const res = await PATCH(req("PATCH", { active: false }), {
      params: Promise.resolve({ challengeId: "x" }),
    });
    expect(res.status).toBe(401);
  });
});
