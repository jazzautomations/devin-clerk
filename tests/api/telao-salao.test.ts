import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { isPublicApi } from "@/lib/access";
import { createTeam } from "@/lib/archive";
import { getOrCreateMember } from "@/lib/members";
import { resetRateLimits } from "@/lib/ratelimit";
import { grantEditionRole } from "@/lib/roles";
import { getStageSnapshot, setScreen, StageError } from "@/lib/stage";
import { resetSalaoCache, salaoDaEdicao } from "@/lib/salao";

// Salão do telão (spec 046, onda 4 — telao-e-bicho-do-time): contrato HTTP
// do salão (consentimento, 404, público), troca de tela pelo controle
// (permissão e 400) e o bicho do time (SVG público, cache por hash).

const clerk = vi.hoisted(() => ({ uid: null as string | null }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: clerk.uid })),
  currentUser: vi.fn(async () => null),
}));

const H = "hack-inova-alphaville-2026";

const ctx = (id = H) => ({ params: Promise.resolve({ id }) });
const post = (body: unknown) =>
  new Request("http://t/api/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const salaoRoute = () => import("@/app/api/hackathons/[id]/salao/route");
const adminRoute = () => import("@/app/api/admin/hackathons/[id]/stage/route");
const timeRoute = () => import("@/app/api/mascote/time/[teamId]/route");
const publicStage = () => import("@/app/api/hackathons/[id]/stage/route");

let seq = 0;
async function member(nome: string) {
  const tag = `salao${seq++}`;
  return getOrCreateMember({ id: `c_${tag}`, firstName: nome, lastName: null, email: `${tag}@t.dev` });
}

/** check-in aprovado; `listing` = consentimento de aparecer (migration 016) */
async function checkIn(memberId: number, listing: boolean, hackathonId = H) {
  await db
    .prepare("INSERT INTO registrations (memberId, hackathonId, status, publicListing) VALUES (?, ?, 'approved', ?)")
    .run(memberId, hackathonId, listing ? 1 : 0);
  const r = await db
    .prepare("SELECT id FROM registrations WHERE memberId = ? AND hackathonId = ?")
    .get<{ id: number }>(memberId, hackathonId);
  await db.prepare("INSERT INTO checkins (registrationId) VALUES (?)").run(r!.id);
}

async function teamCom(nome: string, usernames: string[]): Promise<number> {
  const t = await createTeam(H, { name: nome, placement: 0, project: { title: `Projeto ${nome}` } });
  for (const u of usernames) {
    await db.prepare("INSERT INTO team_members (teamId, username) VALUES (?, ?)").run(t.team.id, u);
  }
  return t.team.id;
}

beforeEach(async () => {
  resetRateLimits();
  resetSalaoCache();
  clerk.uid = null;
  for (const t of ["stage_queue", "stage_sessions", "checkins", "registrations", "edition_roles", "project_submissions"]) {
    await db.exec(`DELETE FROM ${t}`);
  }
  await db.exec("DELETE FROM team_members");
  await db.exec("DELETE FROM team_projects");
  await db.exec("DELETE FROM teams");
});

describe("GET /api/hackathons/[id]/salao", () => {
  it("é público", () => {
    expect(isPublicApi(`/api/hackathons/${H}/salao`)).toBe(true);
    expect(isPublicApi("/api/hackathons/x/salao/outra")).toBe(false);
  });

  it("só entra no JSON quem consentiu aparecer; o resto conta em presentes", async () => {
    const dentro = await member("Ana");
    const fora = await member("Bia");
    await checkIn(dentro.id, true);
    await checkIn(fora.id, false);
    const teamId = await teamCom("Time Alfa", [dentro.username]);
    await db.prepare("INSERT INTO team_members (teamId, username) VALUES (?, ?)").run(teamId, fora.username);

    const res = await (await salaoRoute()).GET(new Request("http://t/x"), ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toContain("max-age=10");
    const body = (await res.json()) as {
      presentes: number;
      times: number;
      entregas: number;
      bichos: { memberId: number; primeiroNome: string; src: string; teamId: number | null }[];
      teams: { id: number; name: string; delivered: boolean; src: string }[];
      configs: Record<string, unknown>;
    };
    expect(body.presentes).toBe(2);
    expect(body.bichos).toHaveLength(1);
    expect(body.bichos[0].memberId).toBe(dentro.id);
    expect(body.bichos[0].primeiroNome).toBe("Ana");
    expect(body.bichos[0].src).toContain(`/api/mascote/m/${dentro.id}`);
    expect(body.bichos[0].teamId).toBe(teamId);
    expect(body.times).toBe(1);
    expect(body.teams[0].src).toBe(`/api/mascote/time/${teamId}`);
    expect(body.configs[dentro.id]).toBeTruthy(); // o telão monta a malha com isso
    expect(JSON.stringify(body)).not.toContain(fora.username);
  });

  it("quem não fez check-in não aparece nem conta", async () => {
    const so = await member("Caio");
    await db
      .prepare("INSERT INTO registrations (memberId, hackathonId, status, publicListing) VALUES (?, ?, 'approved', 1)")
      .run(so.id, H);
    const body = (await (await salaoRoute()).GET(new Request("http://t/x"), ctx()).then((r) => r.json())) as {
      presentes: number;
      bichos: unknown[];
    };
    expect(body.presentes).toBe(0);
    expect(body.bichos).toHaveLength(0);
  });

  it("edição inexistente: 404", async () => {
    const res = await (await salaoRoute()).GET(new Request("http://t/x"), ctx("nao-existe"));
    expect(res.status).toBe(404);
  });

  it("evento do radar (não roda no HackaHub): 404", async () => {
    await db
      .prepare(
        `INSERT INTO hackathons (id, name, organizer, startsAt, format, registrationUrl, tags, active, source)
         VALUES ('radar-salao', 'Externo', 'Sympla', ?, 'online', 'https://x.dev', '[]', 1, 'sympla')
         ON CONFLICT(id) DO UPDATE SET active = 1, source = 'sympla'`,
      )
      .run(new Date().toISOString());
    expect(await salaoDaEdicao("radar-salao")).toBeNull();
    const res = await (await salaoRoute()).GET(new Request("http://t/x"), ctx("radar-salao"));
    expect(res.status).toBe(404);
  });

  it("entrega do time aparece como entrega", async () => {
    const a = await member("Duda");
    await checkIn(a.id, true);
    const teamId = await teamCom("Time Entrega", [a.username]);
    await db
      .prepare("INSERT INTO project_submissions (teamId, version, snapshot) VALUES (?, 1, '{}')")
      .run(teamId);
    const body = (await (await salaoRoute()).GET(new Request("http://t/x"), ctx()).then((r) => r.json())) as {
      entregas: number;
      teams: { delivered: boolean }[];
    };
    expect(body.entregas).toBe(1);
    expect(body.teams[0].delivered).toBe(true);
  });
});

describe("tela do telão", () => {
  it("o snapshot público carrega a tela (default palco)", async () => {
    const snap = await getStageSnapshot(H);
    expect(snap.screen).toBe("palco");
    const res = await (await publicStage()).GET(new Request("http://t/x"), ctx());
    expect(((await res.json()) as { screen: string }).screen).toBe("palco");
  });

  it("troca pra salão e volta, sem perder a final montada", async () => {
    await setScreen(H, "salao");
    const snap = await getStageSnapshot(H);
    expect(snap.screen).toBe("salao");
    expect(snap.status).toBe("idle");
    await setScreen(H, "palco");
    expect((await getStageSnapshot(H)).screen).toBe("palco");
  });

  it("valor inválido: 400", async () => {
    await expect(setScreen(H, "telao")).rejects.toBeInstanceOf(StageError);
    await expect(setScreen(H, "salao")).resolves.toBeTruthy();
  });

  it("staff troca a tela pelo controle; quem não é da edição leva 403", async () => {
    const staff = await member("Staff");
    await grantEditionRole(H, staff.id, "staff", null);
    const rando = await member("Rando");

    clerk.uid = rando.clerkId;
    const negado = await (await adminRoute()).POST(post({ action: "screen", value: "salao" }), ctx());
    expect(negado.status).toBe(403);

    clerk.uid = staff.clerkId;
    const ok = await (await adminRoute()).POST(post({ action: "screen", value: "salao" }), ctx());
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { snapshot: { screen: string } };
    expect(body.snapshot.screen).toBe("salao");

    const ruim = await (await adminRoute()).POST(post({ action: "screen", value: "outra" }), ctx());
    expect(ruim.status).toBe(400);
  });

  it("deslogado: 401 no controle", async () => {
    const res = await (await adminRoute()).POST(post({ action: "screen", value: "salao" }), ctx());
    expect(res.status).toBe(401);
  });
});

describe("GET /api/mascote/time/[teamId]", () => {
  it("devolve o SVG do bicho do time, público, com CSP", async () => {
    const a = await member("Elis");
    const teamId = await teamCom("Time Alfa", [a.username]);
    const res = await (await timeRoute()).GET(new Request(`http://t/api/mascote/time/${teamId}`), {
      params: Promise.resolve({ teamId: String(teamId) }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("image/svg+xml");
    expect(res.headers.get("Content-Security-Policy")).toBe("default-src 'none'");
    expect(res.headers.get("Cache-Control")).toContain("max-age=300");
    const svg = await res.text();
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("<path");
  });

  it("com o hash atual, cache imutável de 1 ano", async () => {
    const a = await member("Fabi");
    const teamId = await teamCom("Time Beta", [a.username]);
    const etag = (
      await (
        await timeRoute()
      ).GET(new Request(`http://t/x`), { params: Promise.resolve({ teamId: String(teamId) }) })
    ).headers.get("ETag")!;
    const hash = etag.replace(/"/g, "");
    const res = await (await timeRoute()).GET(new Request(`http://t/x?v=${hash}`), {
      params: Promise.resolve({ teamId: String(teamId) }),
    });
    expect(res.headers.get("Cache-Control")).toContain("immutable");
  });

  it("time inexistente ou id inválido: 404", async () => {
    for (const id of ["999999", "abc", "0"]) {
      const res = await (await timeRoute()).GET(new Request("http://t/x"), { params: Promise.resolve({ teamId: id }) });
      expect(res.status).toBe(404);
    }
  });

  it("a bandeira com as iniciais muda o SVG em relação ao bicho de um integrante só", async () => {
    const a = await member("Gil");
    const teamId = await teamCom("Time Gama", [a.username]);
    const com = await (
      await timeRoute()
    ).GET(new Request("http://t/x"), { params: Promise.resolve({ teamId: String(teamId) }) });
    const sem = await (await import("@/app/api/mascote/m/[id]/route")).GET(
      new Request(`http://t/api/mascote/m/${a.id}`),
      { params: Promise.resolve({ id: String(a.id) }) },
    );
    expect(await com.text()).not.toBe(await sem.text());
  });
});
