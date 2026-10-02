import { describe, expect, it, vi } from "vitest";
import db from "@/lib/db";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: "clerk_notadmin" })),
  currentUser: vi.fn(async () => null),
}));

db.prepare(
  "INSERT OR IGNORE INTO members (clerkId, username, email, role) VALUES ('clerk_notadmin','notadm_ops','n@t.dev','member')",
).run();

const HID = "hack-inova-alphaville-2026";

const req = (method: string, body?: unknown) =>
  new Request("http://t", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });

describe("guardas de admin ops — não-admin recebe 403", () => {
  it("PATCH hackathon", async () => {
    const { PATCH } = await import("@/app/api/admin/hackathons/[id]/route");
    const res = await PATCH(req("PATCH", { name: "invadido" }), {
      params: Promise.resolve({ id: HID }),
    });
    expect(res.status).toBe(403);
  });

  it("GET registrations", async () => {
    const { GET } = await import(
      "@/app/api/admin/hackathons/[id]/registrations/route"
    );
    const res = await GET(req("GET"), {
      params: Promise.resolve({ id: HID }),
    });
    expect(res.status).toBe(403);
  });

  it("GET subscribers (json e csv)", async () => {
    const { GET } = await import("@/app/api/admin/subscribers/route");
    expect((await GET(req("GET"))).status).toBe(403);
    const csv = await GET(
      new Request("http://t/api/admin/subscribers?format=csv"),
    );
    expect(csv.status).toBe(403);
  });
});
