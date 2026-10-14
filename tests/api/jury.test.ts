import { beforeAll, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { createTeam } from "@/lib/archive";
import { grantEditionRole, revokeEditionRole } from "@/lib/roles";
import { listMemberCertificates } from "@/lib/certificates";
import { updateCertSettings } from "@/lib/certHours";

// API do júri e dos certificados — spec 033 US5/US6. Quem chama é trocado
// mexendo em `who` (o mock do Clerk lê a cada request).

let who: string | null = null;
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: who })),
  currentUser: vi.fn(async () => null),
}));

const H = "hack-inova-alphaville-2026";
const ctx = <T extends Record<string, string>>(extra = {} as T) => ({
  params: Promise.resolve({ id: H, ...extra } as { id: string } & T),
});
const req = (method: string, body?: unknown) =>
  new Request("http://t", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const ids: Record<string, number> = {};
let teamAlheio = 0;
let teamDoJurado = 0;

beforeAll(async () => {
  for (const u of ["api_org", "api_jur", "api_jur2", "api_curioso", "api_colega"]) {
    await db
      .prepare("INSERT OR IGNORE INTO members (clerkId, username, email) VALUES (?, ?, ?)")
      .run(`clerk_${u}`, u, `${u}@t.dev`);
    ids[u] = (await db.prepare("SELECT id FROM members WHERE username = ?").get<{ id: number }>(u))!.id;
  }
  await grantEditionRole(H, ids.api_org, "organizador", null);
  await grantEditionRole(H, ids.api_jur, "jurado", null);
  await grantEditionRole(H, ids.api_jur2, "jurado", null);
  teamAlheio = (await createTeam(H, { name: "API Alheio", placement: 0, memberUsernames: ["api_colega"] })).team.id;
  teamDoJurado = (await createTeam(H, { name: "API do Jurado", placement: 0, memberUsernames: ["api_jur"] })).team.id;
});

describe("júri — guardas", () => {
  it("deslogado leva 401 JSON em todas as rotas", async () => {
    who = null;
    const crit = await import("@/app/api/admin/hackathons/[id]/juri/criteria/route");
    const asg = await import("@/app/api/admin/hackathons/[id]/juri/assignments/route");
    const sc = await import("@/app/api/admin/hackathons/[id]/juri/scores/route");
    const rk = await import("@/app/api/admin/hackathons/[id]/juri/ranking/route");
    const pub = await import("@/app/api/admin/hackathons/[id]/juri/publish/route");
    const cert = await import("@/app/api/admin/hackathons/[id]/certificados/route");
    for (const res of [
      await crit.POST(req("POST", { label: "x", weight: 1 }), ctx()),
      await asg.POST(req("POST", { all: true }), ctx()),
      await sc.POST(req("POST", { teamId: 1, scores: [] }), ctx()),
      await rk.GET(req("GET"), ctx()),
      await pub.POST(req("POST"), ctx()),
      await cert.POST(req("POST"), ctx()),
    ]) {
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "Unauthorized" });
    }
  });

  it("membro sem papel e jurado não mexem em rubrica, atribuição, publicação nem certificado (403)", async () => {
    const crit = await import("@/app/api/admin/hackathons/[id]/juri/criteria/route");
    const asg = await import("@/app/api/admin/hackathons/[id]/juri/assignments/route");
    const pub = await import("@/app/api/admin/hackathons/[id]/juri/publish/route");
    const cert = await import("@/app/api/admin/hackathons/[id]/certificados/route");
    for (const u of ["clerk_api_curioso", "clerk_api_jur"]) {
      who = u;
      expect((await crit.POST(req("POST", { label: "x", weight: 1 }), ctx())).status).toBe(403);
      expect((await asg.POST(req("POST", { all: true }), ctx())).status).toBe(403);
      expect((await pub.POST(req("POST"), ctx())).status).toBe(403);
      expect((await cert.POST(req("POST"), ctx())).status).toBe(403);
    }
  });
});

describe("júri — fluxo", () => {
  let critId = 0;

  it("organizador cria critério, atribui todos (conflito pulado) e o conflito direto dá 409", async () => {
    who = "clerk_api_org";
    const crit = await import("@/app/api/admin/hackathons/[id]/juri/criteria/route");
    const res = await crit.POST(req("POST", { label: "Impacto", weight: 30 }), ctx());
    expect(res.status).toBe(201);
    critId = (await res.json()).criterion.id;
    expect((await crit.POST(req("POST", { label: "", weight: 30 }), ctx())).status).toBe(400);

    const one = await import("@/app/api/admin/hackathons/[id]/juri/criteria/[criterionId]/route");
    const patch = await one.PATCH(req("PATCH", { weight: 40 }), ctx({ criterionId: String(critId) }));
    expect(patch.status).toBe(200);

    const asg = await import("@/app/api/admin/hackathons/[id]/juri/assignments/route");
    const conflito = await asg.POST(req("POST", { judgeMemberId: ids.api_jur, teamId: teamDoJurado }), ctx());
    expect(conflito.status).toBe(409);
    const all = await asg.POST(req("POST", { all: true }), ctx());
    expect(all.status).toBe(200);
    // 2 jurados × 2 times − 1 conflito
    expect(await all.json()).toEqual({ created: 3, conflicts: 1 });
  });

  it("jurado escreve nota só de projeto atribuído; não vê ranking antes de publicar", async () => {
    const sc = await import("@/app/api/admin/hackathons/[id]/juri/scores/route");
    const rk = await import("@/app/api/admin/hackathons/[id]/juri/ranking/route");
    who = "clerk_api_jur";
    const ok = await sc.POST(req("POST", { teamId: teamAlheio, scores: [{ criterionId: critId, score: 4 }], comment: "sólido" }), ctx());
    expect(ok.status).toBe(200);
    const proprio = await sc.POST(req("POST", { teamId: teamDoJurado, scores: [{ criterionId: critId, score: 5 }] }), ctx());
    expect(proprio.status).toBe(403);
    expect((await sc.POST(req("POST", { teamId: teamAlheio, scores: [{ criterionId: critId, score: 9 }] }), ctx())).status).toBe(400);
    expect((await rk.GET(req("GET"), ctx())).status).toBe(403);

    who = "clerk_api_curioso";
    expect((await sc.POST(req("POST", { teamId: teamAlheio, scores: [{ criterionId: critId, score: 4 }] }), ctx())).status).toBe(403);

    who = "clerk_api_org";
    const rank = await rk.GET(req("GET"), ctx());
    expect(rank.status).toBe(200);
    const body = await rank.json();
    expect(body.published).toBe(false);
    expect(body.ranking[0]).toMatchObject({ teamId: teamAlheio, weighted: 4, rank: 1 });
  });

  it("auditoria 041: jurado que perdeu o papel leva 403 e as notas dele saem do ranking", async () => {
    const sc = await import("@/app/api/admin/hackathons/[id]/juri/scores/route");
    const rk = await import("@/app/api/admin/hackathons/[id]/juri/ranking/route");
    who = "clerk_api_jur2";
    const nota = { teamId: teamAlheio, scores: [{ criterionId: critId, score: 1 }] };
    expect((await sc.POST(req("POST", nota), ctx())).status).toBe(200);
    who = "clerk_api_org";
    expect((await (await rk.GET(req("GET"), ctx())).json()).ranking[0]).toMatchObject({ teamId: teamAlheio, weighted: 2.5 });

    // a atribuição antiga fica (quem apaga é lib/roles), mas não vale mais nada
    await revokeEditionRole(H, ids.api_jur2, "jurado");
    who = "clerk_api_jur2";
    const res = await sc.POST(req("POST", { ...nota, scores: [{ criterionId: critId, score: 2 }] }), ctx());
    expect(res.status).toBe(403);
    who = "clerk_api_org";
    expect((await (await rk.GET(req("GET"), ctx())).json()).ranking[0]).toMatchObject({ teamId: teamAlheio, weighted: 4 });
  });

  it("publicar → placement do primeiro e ranking aberto pro jurado; certificados emitem e não duplicam", async () => {
    who = "clerk_api_org";
    const pub = await import("@/app/api/admin/hackathons/[id]/juri/publish/route");
    const res = await pub.POST(req("POST"), ctx());
    expect(res.status).toBe(200);
    const placement = await db.prepare("SELECT placement FROM teams WHERE id = ?").get<{ placement: number }>(teamAlheio);
    expect(placement!.placement).toBe(1);

    who = "clerk_api_jur";
    const rk = await import("@/app/api/admin/hackathons/[id]/juri/ranking/route");
    expect((await rk.GET(req("GET"), ctx())).status).toBe(200);

    who = "clerk_api_org";
    const cert = await import("@/app/api/admin/hackathons/[id]/certificados/route");
    await updateCertSettings(H, { hours: { jurado: 4, organizador: 40 } });
    // edição ainda no futuro → 409
    await db.prepare("UPDATE hackathons SET startsAt = '2999-01-01', endsAt = '2999-01-02' WHERE id = ?").run(H);
    expect((await cert.POST(req("POST"), ctx())).status).toBe(409);
    await db.prepare("UPDATE hackathons SET startsAt = '2020-01-01', endsAt = '2020-01-02' WHERE id = ?").run(H);
    const first = await cert.POST(req("POST"), ctx());
    expect(first.status).toBe(200);
    const again = await cert.POST(req("POST"), ctx());
    expect((await again.json()).created).toBe(0);
    expect((await listMemberCertificates(ids.api_jur)).map((c) => c.kind)).toEqual(["jurado"]);
    // sem inscrição aprovada e check-in não sai premiação (auditoria 041)
    expect(await listMemberCertificates(ids.api_colega)).toEqual([]);
    await db
      .prepare("INSERT INTO registrations (memberId, hackathonId, status) VALUES (?, ?, 'approved')")
      .run(ids.api_colega, H);
    await db
      .prepare("INSERT INTO checkins (registrationId) SELECT id FROM registrations WHERE memberId = ? AND hackathonId = ?")
      .run(ids.api_colega, H);
    expect((await cert.POST(req("POST"), ctx())).status).toBe(200);
    expect((await listMemberCertificates(ids.api_colega)).map((c) => c.kind).sort()).toEqual(["participacao", "premiacao"]);
  });

  it("PDF público responde application/pdf; código desconhecido 404", async () => {
    const [c] = await listMemberCertificates(ids.api_jur);
    const { GET } = await import("@/app/c/[code]/pdf/route");
    const res = await GET(req("GET"), { params: Promise.resolve({ code: c.code }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    const missing = await GET(req("GET"), { params: Promise.resolve({ code: "NAOEXISTE0" }) });
    expect(missing.status).toBe(404);
  });

  it("auditoria 041: PDF de certificado revogado responde 410 sem cache", async () => {
    const [c] = await listMemberCertificates(ids.api_jur);
    const { GET } = await import("@/app/c/[code]/pdf/route");
    await db.prepare("UPDATE certificates SET revokedAt = sqlite_now() WHERE code = ?").run(c.code);
    try {
      const res = await GET(req("GET"), { params: Promise.resolve({ code: c.code }) });
      expect(res.status).toBe(410);
      expect(res.headers.get("content-type")).not.toBe("application/pdf");
      expect(res.headers.get("cache-control")).toBe("no-store");
    } finally {
      await db.prepare("UPDATE certificates SET revokedAt = NULL WHERE code = ?").run(c.code);
    }
  });
});

describe("auditoria 041 — publicar com avaliação faltando", () => {
  const H2 = "hack-inova-puc-saude-2026";
  const ctx2 = () => ({ params: Promise.resolve({ id: H2 }) });

  it("409 com a contagem; force sem motivo 400; force com motivo 200 e o motivo fica gravado", async () => {
    await grantEditionRole(H2, ids.api_org, "organizador", null);
    await grantEditionRole(H2, ids.api_jur, "jurado", null);
    const t1 = (await createTeam(H2, { name: "F1", placement: 0, memberUsernames: ["api_colega"] })).team.id;
    const t2 = (await createTeam(H2, { name: "F2", placement: 0, memberUsernames: [] })).team.id;
    who = "clerk_api_org";
    const crit = await import("@/app/api/admin/hackathons/[id]/juri/criteria/route");
    const c = (await (await crit.POST(req("POST", { label: "Execução", weight: 1 }), ctx2())).json()).criterion.id;
    const asg = await import("@/app/api/admin/hackathons/[id]/juri/assignments/route");
    await asg.POST(req("POST", { all: true }), ctx2());
    who = "clerk_api_jur";
    const sc = await import("@/app/api/admin/hackathons/[id]/juri/scores/route");
    expect((await sc.POST(req("POST", { teamId: t1, scores: [{ criterionId: c, score: 5 }] }), ctx2())).status).toBe(200);

    who = "clerk_api_org";
    const pub = await import("@/app/api/admin/hackathons/[id]/juri/publish/route");
    const recusa = await pub.POST(req("POST"), ctx2());
    expect(recusa.status).toBe(409);
    expect(await recusa.json()).toMatchObject({ missing: 1, missingScores: 1, error: expect.stringMatching(/falta.*1 nota/) });
    expect((await pub.POST(req("POST", { force: true }), ctx2())).status).toBe(400);

    const ok = await pub.POST(req("POST", { force: true, reason: "jurado do F2 ficou doente" }), ctx2());
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ forced: true, first: true });
    const row = await db
      .prepare("SELECT forced, reason FROM jury_results WHERE hackathonId = ?")
      .get<{ forced: boolean; reason: string }>(H2);
    expect(row).toEqual({ forced: true, reason: "jurado do F2 ficou doente" });
    // o pódio ignora quem não tem nota; o time avaliado leva
    const p = await db.prepare("SELECT placement FROM teams WHERE id = ?").get<{ placement: number }>(t1);
    expect(p!.placement).toBe(1);
    expect((await db.prepare("SELECT placement FROM teams WHERE id = ?").get<{ placement: number }>(t2))!.placement).toBe(0);

    // integrante do time avaliado recebe aviso do resultado
    const n = await db
      .prepare("SELECT text, href FROM notifications WHERE memberId = ? AND type = 'jury_result' AND href = ?")
      .all<{ text: string; href: string }>(ids.api_colega, `/h/${H2}`);
    expect(n).toEqual([expect.objectContaining({ href: `/h/${H2}` })]);

    // rubrica travada depois de publicar
    const one = await import("@/app/api/admin/hackathons/[id]/juri/criteria/[criterionId]/route");
    expect((await one.DELETE(req("DELETE"), { params: Promise.resolve({ id: H2, criterionId: String(c) }) })).status).toBe(409);
    expect(
      (await one.PATCH(req("PATCH", { weight: 3 }), { params: Promise.resolve({ id: H2, criterionId: String(c) }) })).status,
    ).toBe(409);
  });
});
