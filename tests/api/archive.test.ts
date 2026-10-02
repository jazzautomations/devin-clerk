import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: "clerk_admin" })),
  currentUser: vi.fn(async () => null),
}));

const HACK = "hack-inova-unifacens-2026";

beforeEach(() => {
  db.prepare(
    "INSERT OR IGNORE INTO members (clerkId, username, email, role) VALUES ('clerk_admin','admin_t','a@t.dev','admin')",
  ).run();
  db.prepare("DELETE FROM team_members").run();
  db.prepare("DELETE FROM team_projects").run();
  db.prepare("DELETE FROM teams").run();
});

const post = (url: string, body: unknown) =>
  new Request(`http://t${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /api/admin/hackathons/[id]/teams", () => {
  it("admin cadastra time com projeto e membros → 201", async () => {
    db.prepare(
      "INSERT OR IGNORE INTO members (clerkId, username, email) VALUES ('c1','dev_x','x@t.dev')",
    ).run();
    const { POST } = await import(
      "@/app/api/admin/hackathons/[id]/teams/route"
    );
    const res = await POST(
      post(`/api/admin/hackathons/${HACK}/teams`, {
        name: "One Day Hospital",
        placement: 1,
        memberUsernames: ["dev_x", "nao_existe"],
        project: {
          title: "One Day Hospital",
          repoUrl: "https://github.com/x/odh",
        },
      }),
      { params: Promise.resolve({ id: HACK }) },
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.team.placement).toBe(1);
    expect(data.ignoredUsernames).toEqual(["nao_existe"]);
  });

  it("400 sem name; 404 edição inexistente", async () => {
    const { POST } = await import(
      "@/app/api/admin/hackathons/[id]/teams/route"
    );
    const bad = await POST(post("/x", { placement: 1 }), {
      params: Promise.resolve({ id: HACK }),
    });
    expect(bad.status).toBe(400);
    const nf = await POST(post("/x", { name: "T", placement: 1 }), {
      params: Promise.resolve({ id: "fantasma" }),
    });
    expect(nf.status).toBe(404);
  });
});

describe("POST /api/admin/hackathons/[id]/assets", () => {
  it("admin cadastra foto → 201; tipo inválido → 400", async () => {
    const { POST } = await import(
      "@/app/api/admin/hackathons/[id]/assets/route"
    );
    const ok = await POST(
      post("/x", { type: "foto", url: "https://imgur.com/a.png" }),
      { params: Promise.resolve({ id: HACK }) },
    );
    expect(ok.status).toBe(201);
    const bad = await POST(
      post("/x", { type: "virus", url: "https://x" }),
      { params: Promise.resolve({ id: HACK }) },
    );
    expect(bad.status).toBe(400);
  });
});
