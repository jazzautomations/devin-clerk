import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
  execFileSync: vi.fn(() => ""),
}));

let clerkUser: string | null = null;
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: clerkUser })),
}));

import db from "@/lib/db";
import { createProjectFixture } from "@/lib/deploys";

const params = (teamId: number) => ({
  params: Promise.resolve({ teamId: String(teamId) }),
});
const req = (method: string, body?: unknown) =>
  new Request("http://localhost/api/x", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? null : JSON.stringify(body),
  });

// Next 16 tipa handlers como podendo retornar void — o helper afirma Response
const call =
  <A extends unknown[]>(fn: (...a: A) => Promise<Response | void>) =>
  async (...a: A) =>
    (await fn(...a)) as Response;

function member(username: string, role = "member") {
  db.prepare(
    `INSERT OR IGNORE INTO members (clerkId, username, email, role)
     VALUES (?, ?, ?, ?)`,
  ).run(`clerk-${username}`, username, `${username}@x.dev`, role);
  return `clerk-${username}`;
}

let teamId: number;
beforeEach(() => {
  clerkUser = null;
  db.exec("DELETE FROM deploys");
  db.exec("DELETE FROM team_members");
  db.exec("DELETE FROM team_projects");
  db.exec("DELETE FROM teams");
  db.exec("DELETE FROM settings WHERE key='deploys_enabled'");
  teamId = createProjectFixture("hack-inova-alphaville-2026");
  db.prepare("INSERT INTO team_members (teamId, username) VALUES (?, ?)").run(teamId, "dev1");
  member("dev1");
  member("boss", "admin");
});

describe("POST /api/projects/[teamId]/deploy", () => {
  it("401 deslogado", async () => {
    const { POST } = await import("@/app/api/projects/[teamId]/deploy/route");
    const res = await call(POST)(req("POST", {}), params(teamId));
    expect(res.status).toBe(401);
  });
  it("403 membro de fora do time", async () => {
    clerkUser = member("random2");
    const { POST } = await import("@/app/api/projects/[teamId]/deploy/route");
    const res = await call(POST)(req("POST", {}), params(teamId));
    expect(res.status).toBe(403);
  });
  it("404 time inexistente", async () => {
    clerkUser = "clerk-boss";
    const { POST } = await import("@/app/api/projects/[teamId]/deploy/route");
    const res = await call(POST)(req("POST", { repoUrl: "https://github.com/o/r" }), params(99999));
    expect(res.status).toBe(404);
  });
  it("202 membro do time — usa repoUrl do projeto", async () => {
    clerkUser = "clerk-dev1";
    const { POST } = await import("@/app/api/projects/[teamId]/deploy/route");
    const res = await call(POST)(req("POST", {}), params(teamId));
    expect(res.status).toBe(202);
    const j = await res.json();
    expect(j.deploy.status).toBe("queued");
    expect(j.deploy.repoUrl).toContain("github.com");
  });
  it("409 segundo deploy ativo", async () => {
    clerkUser = "clerk-dev1";
    const { POST } = await import("@/app/api/projects/[teamId]/deploy/route");
    await call(POST)(req("POST", {}), params(teamId));
    const res = await call(POST)(req("POST", {}), params(teamId));
    expect(res.status).toBe(409);
  });
});

describe("GET + DELETE", () => {
  it("GET retorna status pro dono", async () => {
    clerkUser = "clerk-dev1";
    const { POST, GET } = await import("@/app/api/projects/[teamId]/deploy/route");
    await call(POST)(req("POST", {}), params(teamId));
    const res = await call(GET)(req("GET"), params(teamId));
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.deploy.status).toBe("queued");
  });
  it("DELETE para o deploy", async () => {
    clerkUser = "clerk-dev1";
    const { POST, DELETE } = await import("@/app/api/projects/[teamId]/deploy/route");
    await call(POST)(req("POST", {}), params(teamId));
    const res = await call(DELETE)(req("DELETE"), params(teamId));
    expect(res.status).toBe(200);
    const g = await call(
      (await import("@/app/api/projects/[teamId]/deploy/route")).GET,
    )(req("GET"), params(teamId));
    expect((await g.json()).deploy.status).toBe("stopped");
  });
});

describe("admin", () => {
  it("GET /api/admin/deploys — 403 não-admin", async () => {
    clerkUser = "clerk-dev1";
    const { GET } = await import("@/app/api/admin/deploys/route");
    expect((await call(GET)()).status).toBe(403);
  });
  it("GET /api/admin/deploys — admin lista", async () => {
    clerkUser = "clerk-boss";
    const { GET } = await import("@/app/api/admin/deploys/route");
    const res = await call(GET)();
    expect(res.status).toBe(200);
    expect(Array.isArray((await res.json()).deploys)).toBe(true);
  });
  it("PATCH /api/admin/deploys/config liga/desliga", async () => {
    clerkUser = "clerk-boss";
    const { PATCH } = await import("@/app/api/admin/deploys/config/route");
    const res = await call(PATCH)(req("PATCH", { enabled: false }));
    expect(res.status).toBe(200);
    expect((await res.json()).enabled).toBe(false);
    await call(PATCH)(req("PATCH", { enabled: true }));
  });
});
