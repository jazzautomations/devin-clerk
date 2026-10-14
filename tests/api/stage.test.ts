import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { createTeam } from "@/lib/archive";
import { getOrCreateMember } from "@/lib/members";
import { resetRateLimits } from "@/lib/ratelimit";
import { grantEditionRole } from "@/lib/roles";

// Modo palco — contrato HTTP: controle (organizador/staff), voto ao vivo
// (check-in), snapshot público e SSE.

const clerk = vi.hoisted(() => ({ uid: null as string | null }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: clerk.uid })),
  currentUser: vi.fn(async () => null),
}));

const H = "hack-inova-alphaville-2026";

const ctx = (id = H) => ({ params: Promise.resolve({ id }) });
const req = (method: string, body?: unknown) =>
  new Request("http://t/api/x", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function member(clerkId: string) {
  return getOrCreateMember({ id: clerkId, firstName: null, lastName: null, email: `${clerkId}@t.dev` });
}

async function checkIn(memberId: number) {
  await db
    .prepare("INSERT INTO registrations (memberId, hackathonId, status) VALUES (?, ?, 'approved')")
    .run(memberId, H);
  const r = await db
    .prepare("SELECT id FROM registrations WHERE memberId = ? AND hackathonId = ?")
    .get<{ id: number }>(memberId, H);
  await db.prepare("INSERT INTO checkins (registrationId) VALUES (?)").run(r!.id);
}

let teamA: number;
let teamB: number;

beforeEach(async () => {
  resetRateLimits();
  clerk.uid = null;
  for (const t of ["live_votes", "stage_queue", "stage_sessions", "checkins", "registrations", "edition_roles"]) {
    await db.exec(`DELETE FROM ${t}`);
  }
  await db.exec("DELETE FROM team_members");
  await db.exec("DELETE FROM team_projects");
  await db.exec("DELETE FROM teams");
  await member("c_org");
  await member("c_staff");
  await member("c_rando");
  const org = await member("c_org");
  const staff = await member("c_staff");
  await grantEditionRole(H, org.id, "organizador", null);
  await grantEditionRole(H, staff.id, "staff", null);
  teamA = (await createTeam(H, { name: "Alfa", placement: 0, project: { title: "Projeto Alfa" } })).team.id;
  teamB = (await createTeam(H, { name: "Beta", placement: 0, project: { title: "Projeto Beta" } })).team.id;
});

describe("controle — /api/admin/hackathons/[id]/stage", () => {
  it("401 anon (JSON), 403 sem papel, 404 edição inexistente", async () => {
    const { GET, POST } = await import("@/app/api/admin/hackathons/[id]/stage/route");
    const anon = await POST(req("POST", { action: "next" }), ctx());
    expect(anon.status).toBe(401);
    expect(await anon.json()).toEqual({ error: "Unauthorized" });
    expect((await GET(req("GET"), ctx())).status).toBe(401);

    clerk.uid = "c_rando";
    expect((await POST(req("POST", { action: "next" }), ctx())).status).toBe(403);
    expect((await GET(req("GET"), ctx())).status).toBe(403);

    clerk.uid = "c_org";
    expect((await GET(req("GET"), ctx("nao-existe"))).status).toBe(404);
  });

  it("organizador monta fila, avança, abre votação; 409 em transição impossível; 400 ação ruim", async () => {
    const { GET, POST } = await import("@/app/api/admin/hackathons/[id]/stage/route");
    clerk.uid = "c_org";
    const g = await GET(req("GET"), ctx());
    expect(g.status).toBe(200);
    const state = await g.json();
    expect(state.candidates.map((c: { teamName: string }) => c.teamName)).toEqual(["Alfa", "Beta"]);
    expect(state.snapshot.status).toBe("idle");

    expect((await POST(req("POST", { action: "next" }), ctx())).status).toBe(409); // fila vazia
    expect((await POST(req("POST", { action: "nope" }), ctx())).status).toBe(400);
    expect((await POST(req("POST", [1, 2]), ctx())).status).toBe(400);

    const q = await POST(req("POST", { action: "queue", teamIds: [teamB, teamA] }), ctx());
    expect(q.status).toBe(200);
    expect((await q.json()).queue.map((t: { teamId: number }) => t.teamId)).toEqual([teamB, teamA]);

    const n = await POST(req("POST", { action: "next", from: null }), ctx());
    expect(n.status).toBe(200);
    expect((await n.json()).snapshot.current.teamId).toBe(teamB);
    // duplo toque com o mesmo `from` → 409, não pula
    expect((await POST(req("POST", { action: "next", from: null }), ctx())).status).toBe(409);

    const v = await POST(req("POST", { action: "voting-open" }), ctx());
    expect((await v.json()).snapshot.votingOpen).toBe(true);
  });

  it("staff da edição também opera o palco", async () => {
    const { POST } = await import("@/app/api/admin/hackathons/[id]/stage/route");
    clerk.uid = "c_staff";
    const r = await POST(req("POST", { action: "queue", teamIds: [teamA] }), ctx());
    expect(r.status).toBe(200);
  });
});

describe("voto — /api/hackathons/[id]/stage/vote", () => {
  async function openOn(teamId: number) {
    const { POST } = await import("@/app/api/admin/hackathons/[id]/stage/route");
    const prev = clerk.uid;
    clerk.uid = "c_org";
    await POST(req("POST", { action: "queue", teamIds: [teamA, teamB] }), ctx());
    await POST(req("POST", { action: "goto", teamId }), ctx());
    await POST(req("POST", { action: "voting-open" }), ctx());
    clerk.uid = prev;
  }

  it("401 anon; 403 sem check-in; 200 com check-in; muda a nota; 409 fechada", async () => {
    const { GET, POST } = await import("@/app/api/hackathons/[id]/stage/vote/route");
    const { POST: CONTROL } = await import("@/app/api/admin/hackathons/[id]/stage/route");
    await openOn(teamA);

    const anon = await POST(req("POST", { teamId: teamA, score: 5 }), ctx());
    expect(anon.status).toBe(401);
    expect(anon.headers.get("content-type")).toContain("application/json");
    expect((await GET(req("GET"), ctx())).status).toBe(401);

    clerk.uid = "c_voter";
    const voter = await member("c_voter");
    const semCheckin = await POST(req("POST", { teamId: teamA, score: 5 }), ctx());
    expect(semCheckin.status).toBe(403);
    expect((await semCheckin.json()).error).toContain("check-in");
    expect(await (await GET(req("GET"), ctx())).json()).toMatchObject({ checkedIn: false });

    await checkIn(voter.id);
    const ok = await POST(req("POST", { teamId: teamA, score: 4 }), ctx());
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ score: 4, tally: { count: 1, avg: 4 } });
    const edit = await POST(req("POST", { teamId: teamA, score: 2 }), ctx());
    expect(await edit.json()).toMatchObject({ score: 2, tally: { count: 1, avg: 2 } });
    expect(await (await GET(req("GET"), ctx())).json()).toMatchObject({
      checkedIn: true,
      currentTeamId: teamA,
      myScore: 2,
    });

    expect((await POST(req("POST", { teamId: teamA, score: 9 }), ctx())).status).toBe(400);
    expect((await POST(req("POST", { teamId: teamB, score: 3 }), ctx())).status).toBe(409); // não está no palco

    clerk.uid = "c_org";
    await CONTROL(req("POST", { action: "voting-close" }), ctx());
    clerk.uid = "c_voter";
    expect((await POST(req("POST", { teamId: teamA, score: 5 }), ctx())).status).toBe(409);
  });

  it("403 no próprio time", async () => {
    const { POST } = await import("@/app/api/hackathons/[id]/stage/vote/route");
    const dono = await member("c_dono");
    await checkIn(dono.id);
    await db.prepare("INSERT INTO team_members (teamId, username) VALUES (?, ?)").run(teamA, dono.username);
    await openOn(teamA);
    clerk.uid = "c_dono";
    const r = await POST(req("POST", { teamId: teamA, score: 5 }), ctx());
    expect(r.status).toBe(403);
    expect((await r.json()).error).toContain("próprio time");
  });

  it("429 depois do limite por membro", async () => {
    const { POST } = await import("@/app/api/hackathons/[id]/stage/vote/route");
    const v = await member("c_flood");
    await checkIn(v.id);
    await openOn(teamA);
    clerk.uid = "c_flood";
    let last = 0;
    for (let i = 0; i < 121; i++) {
      last = (await POST(req("POST", { teamId: teamA, score: (i % 5) + 1 }), ctx())).status;
    }
    expect(last).toBe(429);
  });
});

describe("público — snapshot e SSE", () => {
  it("GET /stage devolve snapshot sem login; 404 pra edição inexistente", async () => {
    const { GET } = await import("@/app/api/hackathons/[id]/stage/route");
    const r = await GET(req("GET"), ctx());
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ hackathonId: H, status: "idle", current: null, ranking: null });
    expect((await GET(req("GET"), ctx("nao-existe"))).status).toBe(404);
  });

  it("stream responde text/event-stream com o snapshot no 1º evento", async () => {
    const { GET } = await import("@/app/api/hackathons/[id]/stage/stream/route");
    const ac = new AbortController();
    const r = await GET(new Request("http://t/x", { signal: ac.signal }), ctx());
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/event-stream");
    expect(r.headers.get("cache-control")).toContain("no-cache");
    expect(r.headers.get("x-accel-buffering")).toBe("no");
    const reader = r.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (!buf.includes("event: stage")) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value);
    }
    while (!/event: stage\ndata: .*\n\n/.test(buf)) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value);
    }
    const data = JSON.parse(buf.split("event: stage\ndata: ")[1].split("\n")[0]);
    expect(data).toMatchObject({ hackathonId: H, status: "idle" });
    ac.abort();
    await reader.cancel();
    const { stageChannelCount } = await import("@/lib/stageStream");
    expect(stageChannelCount()).toBe(0); // desconectou → para de consultar o banco
    expect((await GET(new Request("http://t/x"), ctx("nao-existe"))).status).toBe(404);
  });

  // lê o stream por `ms` e devolve o texto (e o reader, pra cancelar)
  async function collect(r: Response, ms: number) {
    const reader = r.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    const end = Date.now() + ms;
    for (;;) {
      const left = end - Date.now();
      if (left <= 0) break;
      const got = await Promise.race([reader.read(), new Promise<null>((ok) => setTimeout(() => ok(null), left))]);
      if (!got || got.done) break;
      buf += dec.decode(got.value);
    }
    return { buf, reader };
  }

  it("auditoria 041: primeiro ouvinte recebe 1 snapshot, não 2 (o 1º tick não repete)", async () => {
    const { GET } = await import("@/app/api/hackathons/[id]/stage/stream/route");
    const ac = new AbortController();
    const r = await GET(new Request("http://t/x", { signal: ac.signal }), ctx());
    const { buf, reader } = await collect(r, 2600); // passa de 2 ticks de 1 s
    expect(buf.match(/event: stage\n/g)).toHaveLength(1);
    ac.abort();
    await reader.cancel();
  });

  it("auditoria 041: acima do teto por IP leva 429; liberar uma conexão abre vaga", async () => {
    const { GET } = await import("@/app/api/hackathons/[id]/stage/stream/route");
    const { stageLimits, stageOpenConnections } = await import("@/lib/stageStream");
    const before = stageLimits.perIp;
    stageLimits.perIp = 5;
    const open: { ac: AbortController; r: Response }[] = [];
    const conn = async (ip: string) => {
      const ac = new AbortController();
      const r = await GET(new Request("http://t/x", { signal: ac.signal, headers: { "x-forwarded-for": ip } }), ctx());
      if (r.status === 200) open.push({ ac, r });
      return r;
    };
    try {
      for (let i = 0; i < 5; i++) expect((await conn("203.0.113.9")).status).toBe(200);
      const sexta = await conn("203.0.113.9");
      expect(sexta.status).toBe(429);
      expect(sexta.headers.get("retry-after")).toBeTruthy();
      expect(await sexta.json()).toMatchObject({ error: expect.any(String) });
      expect((await conn("198.51.100.7")).status).toBe(200); // outro IP segue
      expect(stageOpenConnections()).toBe(6);
      const first = open.shift()!;
      first.ac.abort();
      await first.r.body!.cancel();
      expect((await conn("203.0.113.9")).status).toBe(200);
      // edição inexistente não segura vaga
      expect((await GET(new Request("http://t/x", { headers: { "x-forwarded-for": "192.0.2.1" } }), ctx("nao-existe"))).status).toBe(404);
    } finally {
      for (const o of open) {
        o.ac.abort();
        await o.r.body!.cancel().catch(() => {});
      }
      stageLimits.perIp = before;
    }
    expect(stageOpenConnections()).toBe(0);
  });
});
