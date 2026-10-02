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

describe("guardas de admin — não-admin recebe 403", () => {
  it("POST challenges", async () => {
    const { POST } = await import(
      "@/app/api/admin/hackathons/[id]/challenges/route"
    );
    const res = await POST(req("POST", { sponsor: "S", title: "T" }), {
      params: Promise.resolve({ id: "hack-inova-puc-saude-2026" }),
    });
    expect(res.status).toBe(403);
  });

  it("PATCH challenge", async () => {
    const { PATCH } = await import(
      "@/app/api/admin/challenges/[challengeId]/route"
    );
    const res = await PATCH(req("PATCH", { active: false }), {
      params: Promise.resolve({ challengeId: "seed-puc-jornada-paciente" }),
    });
    expect(res.status).toBe(403);
  });
});
