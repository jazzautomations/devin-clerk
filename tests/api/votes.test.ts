import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { createTeam } from "@/lib/archive";
import "@/lib/votes"; // garante a tabela votes no :memory:

const clerk = vi.hoisted(() => ({ uid: "clerk_voter" as string | null }));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: clerk.uid })),
  currentUser: vi.fn(async () => null),
}));

const UNIFACENS = "hack-inova-unifacens-2026";

function memberId(clerkId: string): number {
  db.prepare(
    "INSERT OR IGNORE INTO members (clerkId, username, email) VALUES (?, ?, ?)",
  ).run(clerkId, `u_${clerkId}`, `${clerkId}@t.dev`);
  return (
    db.prepare("SELECT id FROM members WHERE clerkId = ?").get(clerkId) as {
      id: number;
    }
  ).id;
}

const post = (teamId: string) =>
  new Request(`http://t/api/projects/${teamId}/vote`, { method: "POST" });

const ctx = (teamId: number | string) => ({
  params: Promise.resolve({ teamId: String(teamId) }),
});

let projectTeamId: number;

beforeEach(() => {
  clerk.uid = "clerk_voter";
  memberId("clerk_voter"); // u_clerk_voter
  memberId("clerk_owner"); // u_clerk_owner — integrante do time dono
  db.exec("DELETE FROM votes");
  db.exec("DELETE FROM team_members");
  db.exec("DELETE FROM team_projects");
  db.exec("DELETE FROM teams");
  projectTeamId = createTeam(UNIFACENS, {
    name: "Alvo",
    placement: 0,
    memberUsernames: ["u_clerk_owner"],
    project: { title: "Projeto Alvo" },
  }).team.id;
});

describe("POST /api/projects/[teamId]/vote", () => {
  it("200 — liga: {voted:true,count:1}; repete → {voted:false,count:0}", async () => {
    const { POST } = await import("@/app/api/projects/[teamId]/vote/route");

    const res = await POST(post(String(projectTeamId)), ctx(projectTeamId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ voted: true, count: 1 });

    const res2 = await POST(post(String(projectTeamId)), ctx(projectTeamId));
    expect(res2.status).toBe(200);
    expect(await res2.json()).toEqual({ voted: false, count: 0 });
  });

  it("401 — deslogado; e 401 — clerkId sem member provisionado", async () => {
    const { POST } = await import("@/app/api/projects/[teamId]/vote/route");

    clerk.uid = null;
    const anon = await POST(post(String(projectTeamId)), ctx(projectTeamId));
    expect(anon.status).toBe(401);
    expect(anon.headers.get("content-type")).toContain("application/json");

    clerk.uid = "ghost_sem_member";
    const ghost = await POST(post(String(projectTeamId)), ctx(projectTeamId));
    expect(ghost.status).toBe(401);
  });

  it("404 — teamId inválido, inexistente e time sem projeto", async () => {
    const { POST } = await import("@/app/api/projects/[teamId]/vote/route");

    const bad = await POST(post("abc"), ctx("abc"));
    expect(bad.status).toBe(404);

    const nf = await POST(post("999999"), ctx(999999));
    expect(nf.status).toBe(404);

    const semProjeto = createTeam(UNIFACENS, {
      name: "SemProjeto",
      placement: 0,
    }).team.id;
    const np = await POST(post(String(semProjeto)), ctx(semProjeto));
    expect(np.status).toBe(404);
  });

  it("403 — integrante não vota no próprio time", async () => {
    const { POST } = await import("@/app/api/projects/[teamId]/vote/route");

    clerk.uid = "clerk_owner"; // u_clerk_owner tá em team_members do Alvo
    const res = await POST(post(String(projectTeamId)), ctx(projectTeamId));
    expect(res.status).toBe(403);
    const { error } = await res.json();
    expect(error).toContain("próprio time");

    const n = (
      db
        .prepare("SELECT COUNT(*) n FROM votes WHERE teamId = ?")
        .get(projectTeamId) as { n: number }
    ).n;
    expect(n).toBe(0);
  });
});
