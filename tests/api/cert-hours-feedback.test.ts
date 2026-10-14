import { beforeAll, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { createTeam } from "@/lib/archive";
import { grantEditionRole } from "@/lib/roles";
import { addCriterion, assignAll, publishResults, saveScores } from "@/lib/jury";
import { issueCertificates } from "@/lib/certificates";

// API da carga horária do certificado (roadmap 037 #2) e do feedback do júri
// pro time (#9). Quem chama é trocado mexendo em `who`.

let who: string | null = null;
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: who })),
  currentUser: vi.fn(async () => null),
}));

const H = "hack-inova-alphaville-2026";
const ctx = () => ({ params: Promise.resolve({ id: H }) });
const teamCtx = (teamId: number | string) => ({ params: Promise.resolve({ teamId: String(teamId) }) });
const req = (method: string, body?: unknown) =>
  new Request("http://t", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const ids: Record<string, number> = {};
let team = 0;

beforeAll(async () => {
  for (const u of ["kf_org", "kf_jur", "kf_curioso", "kf_dono"]) {
    await db
      .prepare("INSERT OR IGNORE INTO members (clerkId, username, email, name) VALUES (?, ?, ?, ?)")
      .run(`clerk_${u}`, u, `${u}@t.dev`, u.toUpperCase());
    ids[u] = (await db.prepare("SELECT id FROM members WHERE username = ?").get<{ id: number }>(u))!.id;
  }
  await grantEditionRole(H, ids.kf_org, "organizador", null);
  await grantEditionRole(H, ids.kf_jur, "jurado", null);
  team = (await createTeam(H, { name: "KF Time", placement: 0, memberUsernames: ["kf_dono"] })).team.id;
  const c = await addCriterion(H, { label: "Impacto KF", weight: 1 });
  await assignAll(H);
  await saveScores(H, ids.kf_jur, team, [{ criterionId: c.id, score: 4, feedback: "comentário pro time KF" }], "interno KF");
});

describe("certificados — configuração e CSV", () => {
  it("deslogado: 401 JSON", async () => {
    who = null;
    const cfg = await import("@/app/api/admin/hackathons/[id]/certificados/config/route");
    const csv = await import("@/app/api/admin/hackathons/[id]/certificados/csv/route");
    for (const res of [
      await cfg.GET(req("GET"), ctx()),
      await cfg.PUT(req("PUT", { hours: { participante: 10 } }), ctx()),
      await csv.GET(req("GET"), ctx()),
    ]) {
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "Unauthorized" });
    }
  });

  it("sem papel de organização (curioso, jurado): 403", async () => {
    const cfg = await import("@/app/api/admin/hackathons/[id]/certificados/config/route");
    const csv = await import("@/app/api/admin/hackathons/[id]/certificados/csv/route");
    for (const u of ["clerk_kf_curioso", "clerk_kf_jur"]) {
      who = u;
      expect((await cfg.GET(req("GET"), ctx())).status).toBe(403);
      expect((await cfg.PUT(req("PUT", { hours: { participante: 10 } }), ctx())).status).toBe(403);
      expect((await csv.GET(req("GET"), ctx())).status).toBe(403);
    }
  });

  it("organizador lê, grava (400 em hora inválida) e baixa o CSV com as horas congeladas", async () => {
    who = "clerk_kf_org";
    const cfg = await import("@/app/api/admin/hackathons/[id]/certificados/config/route");
    const csv = await import("@/app/api/admin/hackathons/[id]/certificados/csv/route");
    const bad = await cfg.PUT(req("PUT", { hours: { participante: -1 } }), ctx());
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/horas/);
    const ok = await cfg.PUT(req("PUT", { hours: { jurado: 5 }, institution: "Inst KF" }), ctx());
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ hours: { jurado: 5 }, institution: "Inst KF" });
    expect(await (await cfg.GET(req("GET"), ctx())).json()).toMatchObject({ hours: { jurado: 5 } });

    await issueCertificates(H);
    const res = await csv.GET(req("GET"), ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toContain("horas-complementares");
    const buf = new Uint8Array(await res.arrayBuffer());
    // BOM pro Excel abrir acento certo
    expect([...buf.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(buf);
    expect(text.startsWith("instituicao_aluno,curso,matricula,nome")).toBe(true);
    expect(text).toMatch(/KF_JUR,kf_jur@t\.dev,kf_jur,jurado\(a\),júri,5,.*Inst KF/);
  });
});

describe("júri — liberar feedback", () => {
  it("401 deslogado, 403 jurado/curioso, 400 corpo inválido, 200 organizador", async () => {
    const route = await import("@/app/api/admin/hackathons/[id]/juri/feedback/route");
    who = null;
    expect((await route.POST(req("POST", { released: true }), ctx())).status).toBe(401);
    for (const u of ["clerk_kf_curioso", "clerk_kf_jur"]) {
      who = u;
      expect((await route.POST(req("POST", { released: true }), ctx())).status).toBe(403);
    }
    who = "clerk_kf_org";
    expect((await route.POST(req("POST", { released: "sim" }), ctx())).status).toBe(400);
    const res = await route.POST(req("POST", { released: true }), ctx());
    expect(res.status).toBe(200);
    // liberado mas resultado não publicado: armado, ainda invisível
    expect(await res.json()).toEqual({ released: true, visible: false });
  });

  it("jurado grava feedback pela API de notas", async () => {
    who = "clerk_kf_jur";
    const sc = await import("@/app/api/admin/hackathons/[id]/juri/scores/route");
    const crit = await db.prepare("SELECT id FROM rubric_criteria WHERE label = 'Impacto KF'").get<{ id: number }>();
    const res = await sc.POST(
      req("POST", {
        teamId: team,
        scores: [{ criterionId: crit!.id, score: 4, feedback: "comentário pro time KF" }],
        comment: "interno KF",
        feedback: "geral KF",
      }),
      ctx(),
    );
    expect(res.status).toBe(200);
  });
});

describe("feedback do time — GET /api/projects/[teamId]/feedback", () => {
  it("401 deslogado, 404 time inexistente, 403 quem não é do time", async () => {
    const route = await import("@/app/api/projects/[teamId]/feedback/route");
    who = null;
    const anon = await route.GET(req("GET"), teamCtx(team));
    expect(anon.status).toBe(401);
    expect(await anon.json()).toEqual({ error: "Unauthorized" });
    who = "clerk_kf_dono";
    expect((await route.GET(req("GET"), teamCtx(99999999))).status).toBe(404);
    expect((await route.GET(req("GET"), teamCtx("abc"))).status).toBe(404);
    for (const u of ["clerk_kf_curioso", "clerk_kf_jur", "clerk_kf_org"]) {
      who = u;
      expect((await route.GET(req("GET"), teamCtx(team))).status).toBe(403);
    }
  });

  it("membro: 200 sem dado antes da publicação; 200 com notas e comentários anônimos depois", async () => {
    const route = await import("@/app/api/projects/[teamId]/feedback/route");
    who = "clerk_kf_dono";
    const before = await route.GET(req("GET"), teamCtx(team));
    expect(before.status).toBe(200);
    expect(await before.json()).toEqual({ released: false });

    await publishResults(H, ids.kf_org);
    const after = await route.GET(req("GET"), teamCtx(team));
    expect(after.status).toBe(200);
    expect(after.headers.get("cache-control")).toContain("no-store");
    const body = await after.json();
    expect(body.released).toBe(true);
    expect(body.feedback.criteria[0]).toMatchObject({ label: "Impacto KF", team: 4, comments: ["comentário pro time KF"] });
    expect(body.feedback.general).toEqual(["geral KF"]);
    const blob = JSON.stringify(body);
    expect(blob).not.toContain("interno KF");
    expect(blob).not.toContain("kf_jur");
  });
});
