import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { resetRateLimits } from "@/lib/ratelimit"; // spec 031

const clerk = vi.hoisted(() => ({ uid: "clerk_capitao" as string | null }));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: clerk.uid })),
  currentUser: vi.fn(async () => null),
}));

const HID = "hack-inova-alphaville-2026"; // edição futura ativa (seed)

function memberId(clerkId: string, username?: string): number {
  db.prepare(
    "INSERT OR IGNORE INTO members (clerkId, username, email) VALUES (?, ?, ?)",
  ).run(clerkId, username ?? `u_${clerkId}`, `${clerkId}@t.dev`);
  return (
    db.prepare("SELECT id FROM members WHERE clerkId = ?").get(clerkId) as {
      id: number;
    }
  ).id;
}

function registerMember(mid: number, hid = HID) {
  db.prepare(
    "INSERT OR IGNORE INTO registrations (memberId, hackathonId) VALUES (?, ?)",
  ).run(mid, hid);
}

const req = (method: string, body?: unknown) =>
  new Request("http://t", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? null : JSON.stringify(body),
  });

const ctx = (id = HID) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  clerk.uid = "clerk_capitao";
  resetRateLimits(); // capitao soma >10 POSTs no arquivo; quota zera entre casos
  db.prepare("DELETE FROM team_members").run();
  db.prepare("DELETE FROM team_projects").run();
  db.prepare("DELETE FROM teams").run();
});

describe("GET /api/hackathons/[id]/team — meu time na edição", () => {
  it("401 deslogado; 404 sem time; 200 com team+project próprios", async () => {
    const { GET, POST } = await import(
      "@/app/api/hackathons/[id]/team/route"
    );
    const mid = memberId("clerk_capitao", "capitao");
    registerMember(mid);
    await POST(
      req("POST", {
        name: "GET Team",
        project: { title: "App", repoUrl: "https://github.com/x/a" },
      }),
      ctx(),
    );

    clerk.uid = null;
    const anon = await GET(req("GET"), ctx());
    expect(anon.status).toBe(401);

    clerk.uid = "clerk_sem_time";
    const mid2 = memberId("clerk_sem_time", "sem_time");
    registerMember(mid2);
    const none = await GET(req("GET"), ctx());
    expect(none.status).toBe(404);

    clerk.uid = "clerk_capitao";
    const res = await GET(req("GET"), ctx());
    expect(res.status).toBe(200);
    const { team } = await res.json();
    expect(team.name).toBe("GET Team");
    expect(team.members).toContain("capitao");
    expect(team.project.title).toBe("App");
  });

  it("404 — edição inexistente", async () => {
    const { GET } = await import("@/app/api/hackathons/[id]/team/route");
    const mid = memberId("clerk_capitao", "capitao");
    registerMember(mid);
    const res = await GET(req("GET"), ctx("fantasma"));
    expect(res.status).toBe(404);
  });
});

describe("POST /api/hackathons/[id]/team — submissão do inscrito", () => {
  it("201 — cria time placement 0, autor dentro, +15xp, colegas inscritos", async () => {
    const { POST } = await import("@/app/api/hackathons/[id]/team/route");
    const mid = memberId("clerk_capitao", "capitao");
    registerMember(mid);
    const midColega = memberId("clerk_colega", "colega_reg");
    registerMember(midColega);
    memberId("clerk_ghost_m", "sem_inscricao"); // membro sem registration

    const before = (
      db.prepare("SELECT xp FROM members WHERE id = ?").get(mid) as {
        xp: number;
      }
    ).xp;

    const res = await POST(
      req("POST", {
        name: "Submetidos",
        memberUsernames: ["colega_reg", "sem_inscricao", "nao_existe"],
        project: {
          title: "Projeto X",
          description: "desc",
          repoUrl: "https://github.com/x/px",
          demoUrl: "https://demo.t.dev",
        },
      }),
      ctx(),
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.team.placement).toBe(0);
    expect(data.team.members).toEqual(
      expect.arrayContaining(["capitao", "colega_reg"]),
    );
    expect(data.ignoredUsernames).toEqual(
      expect.arrayContaining(["sem_inscricao", "nao_existe"]),
    );
    expect(data.xp).toBe("+15");

    const after = (
      db.prepare("SELECT xp FROM members WHERE id = ?").get(mid) as {
        xp: number;
      }
    ).xp;
    expect(after - before).toBe(15);
  });

  it("201 — aceita videoUrl/logoUrl; 400 quando não-http(s) (spec 030)", async () => {
    const { POST } = await import("@/app/api/hackathons/[id]/team/route");
    const mid = memberId("clerk_capitao", "capitao");
    registerMember(mid);
    const res = await POST(
      req("POST", {
        name: "Time Mídia",
        project: {
          title: "Pitch",
          videoUrl: "https://youtu.be/x",
          logoUrl: "https://img.t.dev/l.png",
        },
      }),
      ctx(),
    );
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.team.project.videoUrl).toBe("https://youtu.be/x");
    expect(data.team.project.logoUrl).toBe("https://img.t.dev/l.png");

    for (const [i, project] of [
      { title: "P", videoUrl: "javascript:x" },
      { title: "P", logoUrl: "ftp://img" },
    ].entries()) {
      clerk.uid = `clerk_bad_${i}`;
      const badMid = memberId(`clerk_bad_${i}`, `bad_${i}`);
      registerMember(badMid);
      const bad = await POST(req("POST", { name: `Bad ${i}`, project }), ctx());
      expect(bad.status).toBe(400);
    }
    clerk.uid = "clerk_capitao";
  });

  it("401 — deslogado; clerkId sem member também 401", async () => {
    const { POST } = await import("@/app/api/hackathons/[id]/team/route");
    clerk.uid = null;
    const anon = await POST(req("POST", { name: "X" }), ctx());
    expect(anon.status).toBe(401);

    clerk.uid = "ghost_sem_member";
    const ghost = await POST(req("POST", { name: "X" }), ctx());
    expect(ghost.status).toBe(401);
  });

  it("403 — membro não inscrito recebe 'inscreve-te primeiro'", async () => {
    const { POST } = await import("@/app/api/hackathons/[id]/team/route");
    clerk.uid = "clerk_noreg";
    memberId("clerk_noreg"); // sem registration
    const res = await POST(req("POST", { name: "X" }), ctx());
    expect(res.status).toBe(403);
    const { error } = await res.json();
    expect(error).toMatch(/inscreve/i);
  });

  it("404 — edição inexistente", async () => {
    const { POST } = await import("@/app/api/hackathons/[id]/team/route");
    const mid = memberId("clerk_capitao", "capitao");
    registerMember(mid);
    const res = await POST(req("POST", { name: "X" }), ctx("fantasma"));
    expect(res.status).toBe(404);
  });

  it("400 — sem name, projeto sem título, URL inválida", async () => {
    const { POST } = await import("@/app/api/hackathons/[id]/team/route");
    const mid = memberId("clerk_capitao", "capitao");
    registerMember(mid);
    for (const body of [
      {},
      { name: "  " },
      { name: "Ok", project: { description: "órfão" } },
      { name: "Ok", project: { title: "P", repoUrl: "javascript:x" } },
    ]) {
      const res = await POST(req("POST", body), ctx());
      expect(res.status).toBe(400);
    }
    expect(
      (
        db.prepare("SELECT COUNT(*) n FROM teams WHERE hackathonId = ?").get(HID) as {
          n: number;
        }
      ).n,
    ).toBe(0);
  });

  it("409 — já tem time na edição; nome já usado", async () => {
    const { POST } = await import("@/app/api/hackathons/[id]/team/route");
    const mid = memberId("clerk_capitao", "capitao");
    registerMember(mid);

    const first = await POST(req("POST", { name: "Original" }), ctx());
    expect(first.status).toBe(201);

    // mesmo autor de novo → 409
    const again = await POST(req("POST", { name: "Outro" }), ctx());
    expect(again.status).toBe(409);

    // outro membro, mesmo nome → 409
    clerk.uid = "clerk_copycat";
    const mid2 = memberId("clerk_copycat", "copycat");
    registerMember(mid2);
    const dupe = await POST(req("POST", { name: "Original" }), ctx());
    expect(dupe.status).toBe(409);
  });
});

describe("PATCH /api/hackathons/[id]/team — editar projeto do próprio time", () => {
  async function setupTeam() {
    const { POST } = await import("@/app/api/hackathons/[id]/team/route");
    const mid = memberId("clerk_capitao", "capitao");
    registerMember(mid);
    const res = await POST(
      req("POST", {
        name: "Patcháveis",
        project: { title: "v1", repoUrl: "https://github.com/x/v1" },
      }),
      ctx(),
    );
    const { team } = await res.json();
    return team as { id: number; name: string };
  }

  it("200 — integrante edita; string vazia limpa campo", async () => {
    const { PATCH } = await import("@/app/api/hackathons/[id]/team/route");
    const team = await setupTeam();
    const res = await PATCH(
      req("PATCH", {
        teamId: team.id,
        title: "v2",
        description: "final",
        repoUrl: "",
        demoUrl: "https://demo.t.dev",
      }),
      ctx(),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.team.project.title).toBe("v2");
    expect(data.team.project.description).toBe("final");
    expect(data.team.project.repoUrl).toBeNull();
    expect(data.team.project.demoUrl).toBe("https://demo.t.dev");
  });

  it("401 — deslogado", async () => {
    const { PATCH } = await import("@/app/api/hackathons/[id]/team/route");
    const team = await setupTeam();
    clerk.uid = null;
    const res = await PATCH(
      req("PATCH", { teamId: team.id, title: "x" }),
      ctx(),
    );
    expect(res.status).toBe(401);
  });

  it("403 — membro fora do time; 404 — time inexistente/outra edição", async () => {
    const { PATCH } = await import("@/app/api/hackathons/[id]/team/route");
    const team = await setupTeam();

    clerk.uid = "clerk_stalker";
    memberId("clerk_stalker", "stalker");
    const forbidden = await PATCH(
      req("PATCH", { teamId: team.id, title: "hack" }),
      ctx(),
    );
    expect(forbidden.status).toBe(403);

    clerk.uid = "clerk_capitao";
    const nf = await PATCH(
      req("PATCH", { teamId: 999999, title: "x" }),
      ctx(),
    );
    expect(nf.status).toBe(404);

    // time de OUTRA edição → 404 (escopo da rota)
    db.prepare(
      "INSERT INTO teams (hackathonId, name, placement) VALUES ('hack-inova-puc-saude-2026', 'Alheio', 0)",
    ).run();
    const other = db
      .prepare(
        "SELECT id FROM teams WHERE hackathonId = 'hack-inova-puc-saude-2026' AND name = 'Alheio'",
      )
      .get() as { id: number };
    const wrong = await PATCH(
      req("PATCH", { teamId: other.id, title: "x" }),
      ctx(),
    );
    expect(wrong.status).toBe(404);
  });

  it("400 — patch sem campos válidos; URL inválida", async () => {
    const { PATCH } = await import("@/app/api/hackathons/[id]/team/route");
    const team = await setupTeam();
    for (const body of [
      {},
      { teamId: team.id },
      { teamId: team.id, title: "  " },
      { teamId: team.id, repoUrl: "javascript:x" },
      { teamId: team.id, videoUrl: "javascript:x" },
      { teamId: team.id, logoUrl: "ftp://img" },
    ]) {
      const res = await PATCH(req("PATCH", body), ctx());
      expect(res.status).toBe(400);
    }
  });

  it("200 — PATCH aceita videoUrl/logoUrl e limpa com string vazia (spec 030)", async () => {
    const { PATCH } = await import("@/app/api/hackathons/[id]/team/route");
    const team = await setupTeam();
    const res = await PATCH(
      req("PATCH", {
        teamId: team.id,
        videoUrl: "https://vimeo.com/1",
        logoUrl: "https://img.t.dev/l.png",
      }),
      ctx(),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.team.project.videoUrl).toBe("https://vimeo.com/1");
    expect(data.team.project.logoUrl).toBe("https://img.t.dev/l.png");

    const cleared = await PATCH(
      req("PATCH", { teamId: team.id, videoUrl: "", logoUrl: "" }),
      ctx(),
    );
    const d2 = await cleared.json();
    expect(d2.team.project.videoUrl).toBeNull();
    expect(d2.team.project.logoUrl).toBeNull();
  });
});
