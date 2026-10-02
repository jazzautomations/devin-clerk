import { describe, expect, it, vi } from "vitest";
import db from "@/lib/db";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: "clerk_notadmin" })),
  currentUser: vi.fn(async () => null),
}));

db.prepare(
  "INSERT OR IGNORE INTO members (clerkId, username, email, role) VALUES ('clerk_notadmin','notadm','n@t.dev','member')",
).run();

const post = (body: unknown) =>
  new Request("http://t", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("guardas de admin — não-admin recebe 403", () => {
  it("POST teams", async () => {
    const { POST } = await import(
      "@/app/api/admin/hackathons/[id]/teams/route"
    );
    const res = await POST(post({ name: "T", placement: 1 }), {
      params: Promise.resolve({ id: "hack-inova-unifacens-2026" }),
    });
    expect(res.status).toBe(403);
  });

  it("POST assets", async () => {
    const { POST } = await import(
      "@/app/api/admin/hackathons/[id]/assets/route"
    );
    const res = await POST(
      post({ type: "foto", url: "https://x" }),
      { params: Promise.resolve({ id: "hack-inova-unifacens-2026" }) },
    );
    expect(res.status).toBe(403);
  });
});
