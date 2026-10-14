import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { createTeam } from "@/lib/archive";
import { createChallenge } from "@/lib/challenges";
import { toDbTime } from "@/lib/entries";
import { grantEditionRole } from "@/lib/roles";

// API da entrega (spec 034): time envia, organização configura/reabre,
// staff põe vídeo do palco, cron manda lembrete. 401/403/400/200.

let who: string | null = null;
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: who })),
  currentUser: vi.fn(async () => null),
}));

const H = "hack-inova-alphaville-2026";
const ctx = <T extends Record<string, string>>(extra = {} as T) => ({
  params: Promise.resolve({ id: H, ...extra } as { id: string } & T),
});
const req = (method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request("http://t", {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const ids: Record<string, number> = {};
let teamId = 0;

const full = {
  title: "Mapa da Fome",
  description: "## Problema\n...",
  priorWork: "protótipo de 2025 no Figma",
  technologies: ["Next.js"],
  repoUrl: "https://github.com/t/mapa",
};

async function setDeadline(d: Date) {
  await db.prepare("UPDATE hackathons SET submissionDeadline = ?, submissionGraceMinutes = 0 WHERE id = ?").run(toDbTime(d), H);
}

beforeAll(async () => {
  for (const u of ["e_org", "e_staff", "e_dev", "e_dev2", "e_fora"]) {
    await db
      .prepare("INSERT OR IGNORE INTO members (clerkId, username, email) VALUES (?, ?, ?)")
      .run(`clerk_${u}`, u, `${u}@t.dev`);
    ids[u] = (await db.prepare("SELECT id FROM members WHERE username = ?").get<{ id: number }>(u))!.id;
    await db.prepare("INSERT OR IGNORE INTO registrations (memberId, hackathonId) VALUES (?, ?)").run(ids[u], H);
  }
  await grantEditionRole(H, ids.e_org, "organizador", null);
  await grantEditionRole(H, ids.e_staff, "staff", null);
  teamId = (await createTeam(H, { name: "API Entrega", placement: 0, memberUsernames: ["e_dev", "e_dev2"] })).team.id;
});

beforeEach(async () => {
  await setDeadline(new Date(Date.now() + 3_600_000));
});

describe("entrega do time — /api/hackathons/[id]/entry", () => {
  it("401 deslogado em GET/PATCH/POST", async () => {
    who = null;
    const r = await import("@/app/api/hackathons/[id]/entry/route");
    for (const res of [await r.GET(req("GET"), ctx()), await r.PATCH(req("PATCH", { title: "x" }), ctx()), await r.POST(req("POST"), ctx())]) {
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "Unauthorized" });
    }
  });

  it("sem time → 404; URL ruim → 400", async () => {
    const r = await import("@/app/api/hackathons/[id]/entry/route");
    who = "clerk_e_fora";
    expect((await r.GET(req("GET"), ctx())).status).toBe(404);
    who = "clerk_e_dev";
    expect((await r.PATCH(req("PATCH", { title: "Mapa", repoUrl: "ftp://x" }), ctx())).status).toBe(400);
  });

  it("enviar sem tagline → 400 com o que falta; com tagline → 201 versão 1", async () => {
    const r = await import("@/app/api/hackathons/[id]/entry/route");
    who = "clerk_e_dev";
    const saved = await r.PATCH(req("PATCH", full), ctx());
    expect(saved.status).toBe(200);
    expect((await saved.json()).entry.lastSavedAt).toBeTruthy();
    const semTagline = await r.POST(req("POST"), ctx());
    expect(semTagline.status).toBe(400);
    expect((await semTagline.json()).missing).toEqual(["tagline"]);
    await r.PATCH(req("PATCH", { tagline: "onde falta comida, em mapa" }), ctx());
    const ok = await r.POST(req("POST"), ctx());
    expect(ok.status).toBe(201);
    const body = await ok.json();
    expect(body.version).toBe(1);
    expect(body.entry.status).toBe("enviado");
  });

  it("depois do prazo: PATCH em campo avaliado 403; notas pós-evento 200", async () => {
    await setDeadline(new Date(Date.now() - 60_000));
    const r = await import("@/app/api/hackathons/[id]/entry/route");
    who = "clerk_e_dev2";
    expect((await r.PATCH(req("PATCH", { tagline: "tarde demais" }), ctx())).status).toBe(403);
    expect((await r.POST(req("POST"), ctx())).status).toBe(403);
    const notes = await r.PATCH(req("PATCH", { afterNotes: "virou startup" }), ctx());
    expect(notes.status).toBe(200);
    expect((await notes.json()).entry.afterNotes).toBe("virou startup");
    // o PATCH antigo do time também trava
    const team = await import("@/app/api/hackathons/[id]/team/route");
    expect((await team.PATCH(req("PATCH", { teamId, title: "porta dos fundos" }), ctx())).status).toBe(403);
  });

  it("desafio de outra edição → 400", async () => {
    const r = await import("@/app/api/hackathons/[id]/entry/route");
    who = "clerk_e_dev";
    expect((await r.PATCH(req("PATCH", { challengeIds: ["chal-inexistente"] }), ctx())).status).toBe(400);
    const c = await createChallenge(H, { sponsor: "Acme", title: "IA" });
    expect((await r.PATCH(req("PATCH", { challengeIds: [c.id] }), ctx())).status).toBe(200);
  });
});

describe("painel de entregas — /api/admin/hackathons/[id]/entregas", () => {
  it("401 deslogado; 403 sem papel; staff lê mas não configura", async () => {
    const list = await import("@/app/api/admin/hackathons/[id]/entregas/route");
    const one = await import("@/app/api/admin/hackathons/[id]/entregas/[teamId]/route");
    const prem = await import("@/app/api/admin/hackathons/[id]/premios/route");
    who = null;
    expect((await list.GET(req("GET"), ctx())).status).toBe(401);
    expect((await list.PATCH(req("PATCH", { requireVideo: true }), ctx())).status).toBe(401);
    expect((await one.POST(req("POST", { reason: "x" }), ctx({ teamId: String(teamId) }))).status).toBe(401);
    expect((await prem.POST(req("POST", { kind: "geral", name: "Geral" }), ctx())).status).toBe(401);
    who = "clerk_e_dev";
    expect((await list.GET(req("GET"), ctx())).status).toBe(403);
    expect((await one.POST(req("POST", { reason: "x" }), ctx({ teamId: String(teamId) }))).status).toBe(403);
    expect((await one.PATCH(req("PATCH", { stageVideoUrl: "https://youtu.be/x" }), ctx({ teamId: String(teamId) }))).status).toBe(403);
    who = "clerk_e_staff";
    expect((await list.GET(req("GET"), ctx())).status).toBe(200);
    expect((await list.PATCH(req("PATCH", { requireVideo: true }), ctx())).status).toBe(403);
    expect((await one.POST(req("POST", { reason: "x" }), ctx({ teamId: String(teamId) }))).status).toBe(403);
    expect((await one.PATCH(req("PATCH", { finalist: true }), ctx({ teamId: String(teamId) }))).status).toBe(403);
    const palco = await one.PATCH(req("PATCH", { stageVideoUrl: "https://youtu.be/palco" }), ctx({ teamId: String(teamId) }));
    expect(palco.status).toBe(200);
  });

  it("organizador configura prazos, reabre (sem motivo 400) e cria categoria", async () => {
    const list = await import("@/app/api/admin/hackathons/[id]/entregas/route");
    const one = await import("@/app/api/admin/hackathons/[id]/entregas/[teamId]/route");
    const prem = await import("@/app/api/admin/hackathons/[id]/premios/route");
    who = "clerk_e_org";
    expect((await list.PATCH(req("PATCH", { submissionGraceMinutes: 30 }), ctx())).status).toBe(400);
    const cfg = await list.PATCH(req("PATCH", { submissionDeadline: "2026-11-20T18:00", submissionGraceMinutes: 5 }), ctx());
    expect(cfg.status).toBe(200);
    expect((await cfg.json()).settings.submissionDeadline).toBe("2026-11-20 21:00:00");

    expect((await one.POST(req("POST", {}), ctx({ teamId: String(teamId) }))).status).toBe(400);
    expect((await one.POST(req("POST", { reason: "x" }), ctx({ teamId: "999999" }))).status).toBe(404);
    const reab = await one.POST(req("POST", { reason: "queda de luz", minutes: 30 }), ctx({ teamId: String(teamId) }));
    expect(reab.status).toBe(200);
    expect((await reab.json()).reopenedUntil).toBeTruthy();

    const got = await list.GET(req("GET"), ctx());
    const data = await got.json();
    expect(data.entries[0]).toMatchObject({ teamName: "API Entrega", versions: 1, stageVideoUrl: "https://youtu.be/palco" });
    expect(data.events.map((e: { kind: string }) => e.kind)).toContain("reaberto");

    expect((await prem.POST(req("POST", { kind: "desafio", challengeId: "nao-existe" }), ctx())).status).toBe(404);
    expect((await prem.POST(req("POST", { kind: "outro" }), ctx())).status).toBe(400);
    const cat = await prem.POST(req("POST", { kind: "geral", name: "Grande prêmio", places: 3 }), ctx());
    expect(cat.status).toBe(201);
    const catId = (await cat.json()).category.id;
    const del = await import("@/app/api/admin/hackathons/[id]/premios/[categoryId]/route");
    expect((await del.DELETE(req("DELETE"), ctx({ categoryId: String(catId) }))).status).toBe(200);
    expect((await del.DELETE(req("DELETE"), ctx({ categoryId: String(catId) }))).status).toBe(404);
  });
});

describe("cron de lembretes — /api/cron/submissions", () => {
  it("401 sem segredo ou com segredo errado; 200 com Bearer certo", async () => {
    const { POST } = await import("@/app/api/cron/submissions/route");
    const old = process.env.HACKAHUB_CRON_SECRET;
    delete process.env.HACKAHUB_CRON_SECRET;
    expect((await POST(req("POST", undefined, { authorization: "Bearer x" }))).status).toBe(401);
    process.env.HACKAHUB_CRON_SECRET = "segredo-de-teste";
    expect((await POST(req("POST"))).status).toBe(401);
    expect((await POST(req("POST", undefined, { authorization: "Bearer errado" }))).status).toBe(401);
    const ok = await POST(req("POST", undefined, { authorization: "Bearer segredo-de-teste" }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ reminders: expect.any(Number), lockNotices: expect.any(Number) });
    if (old === undefined) delete process.env.HACKAHUB_CRON_SECRET;
    else process.env.HACKAHUB_CRON_SECRET = old;
  });
});
