import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { grantEditionRole } from "@/lib/roles";
import { addEditionSponsor, claimSponsorInvites, sponsorLogosForChallenges } from "@/lib/editionSponsors";
import { getSponsorReport } from "@/lib/sponsorReport";
import { deleteMemberData, exportMemberData } from "@/lib/privacy";

// Frente O (migration 017) — patrocinadores da edição, relatório e opt-in de
// contato por QR. Isolamento entre marcas, nada pessoal sem opt-in,
// revogação na hora, LGPD e guardas 401/403/400/404.

const clerk = vi.hoisted(() => ({ uid: null as string | null }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: clerk.uid })),
  currentUser: vi.fn(async () => null),
}));

const H = "spons-api";
const OTHER = "spons-api-outra";
let seq = 0;
type M = { id: number; clerkId: string; email: string; username: string };
async function member(opts: { role?: string; status?: string; edition?: string; checkin?: boolean; name?: string } = {}) {
  const tag = `spa${seq++}`;
  const row = await db
    .prepare(
      `INSERT INTO members (clerkId, username, name, email, role, linkedin, github, personas)
       VALUES (?, ?, ?, ?, ?, ?, ?, '["dev"]') RETURNING id`,
    )
    .get<{ id: number }>(
      `clerk_${tag}`,
      `u_${tag}`,
      opts.name ?? `Pessoa ${tag}`,
      `${tag}@t.dev`,
      opts.role ?? "member",
      `https://linkedin.com/in/${tag}`,
      `https://github.com/${tag}`,
    );
  if (opts.status) {
    const r = await db
      .prepare("INSERT INTO registrations (memberId, hackathonId, status) VALUES (?, ?, ?) RETURNING id")
      .get<{ id: number }>(row!.id, H, opts.status);
    if (opts.checkin) await db.prepare("INSERT INTO checkins (registrationId) VALUES (?)").run(r!.id);
  }
  if (opts.edition) await grantEditionRole(H, row!.id, opts.edition as "organizador", null);
  return { id: row!.id, clerkId: `clerk_${tag}`, email: `${tag}@t.dev`, username: `u_${tag}` } as M;
}
const as = (m: { clerkId: string } | null) => {
  clerk.uid = m?.clerkId ?? null;
};
const req = (method: string, body?: unknown, url = "http://t") =>
  new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
const ctx = (id = H) => ({ params: Promise.resolve({ id }) });
const sctx = (sponsorId: string, id = H) => ({ params: Promise.resolve({ id, sponsorId }) });

let org: M;
let A: string;
let B: string;
let chalA: string;
let teamId: number;

beforeAll(async () => {
  for (const id of [H, OTHER]) {
    await db
      .prepare(
        `INSERT INTO hackathons (id, name, organizer, startsAt, endsAt, format, registrationUrl)
         VALUES (?, 'Edição Patrocinada', 'Hack Inova', '2026-09-01 12:00:00', '2026-09-02 20:00:00', 'presencial', 'https://x.dev')`,
      )
      .run(id);
  }
  org = await member({ edition: "organizador" });
  A = (await addEditionSponsor(H, { name: "Marca A", tier: "master", logoUrl: "https://a.dev/logo.png" }, org.id)).sponsorId;
  B = (await addEditionSponsor(H, { name: "Marca B" }, org.id)).sponsorId;
  chalA = "chal-spons-a";
  await db
    .prepare("INSERT INTO challenges (id, hackathonId, sponsor, sponsorId, title, prize) VALUES (?, ?, 'Marca A', NULL, 'Desafio A', 'R$ 5 mil')")
    .run(chalA, H);
  await db
    .prepare("INSERT INTO challenges (id, hackathonId, sponsor, title) VALUES ('chal-spons-b', ?, 'Marca B', 'Desafio B')")
    .run(H);
  // time do modo antigo (sem prazo) que entrou no desafio A, com integrante aprovado
  const dev = await member({ status: "approved", checkin: true, name: "Integrante Secreto" });
  const t = await db
    .prepare("INSERT INTO teams (hackathonId, name) VALUES (?, 'Time Alfa') RETURNING id")
    .get<{ id: number }>(H);
  teamId = t!.id;
  await db.prepare("INSERT INTO team_members (teamId, username) VALUES (?, ?)").run(teamId, dev.username);
  await db
    .prepare(
      `INSERT INTO team_projects (teamId, title, tagline, repoUrl, demoUrl, technologies)
       VALUES (?, 'Projeto Alfa', 'resolve tudo', 'https://github.com/alfa', 'https://alfa.dev', '["Next.js","Python"]')`,
    )
    .run(teamId);
  await db.prepare("INSERT INTO project_challenges (teamId, challengeId) VALUES (?, ?)").run(teamId, chalA);
  for (let i = 0; i < 3; i++) await member({ status: "approved" });
  await member({ status: "pending" });
});
afterEach(() => as(null));

describe("cadastro do patrocinador na edição", () => {
  it("401 deslogado, 403 sem papel/staff, 404 edição inexistente", async () => {
    const { GET, POST } = await import("@/app/api/admin/hackathons/[id]/sponsors/route");
    const r = await GET(req("GET"), ctx());
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: "Unauthorized" });
    expect((await POST(req("POST", { name: "X" }), ctx())).status).toBe(401);
    as(await member({ status: "approved" }));
    expect((await POST(req("POST", { name: "X" }), ctx())).status).toBe(403);
    as(await member({ edition: "staff" }));
    expect((await GET(req("GET"), ctx())).status).toBe(403);
    as(org);
    expect((await GET(req("GET"), ctx("nao-existe"))).status).toBe(404);
  });

  it("400 sem nome / URL ruim / nível inválido; 409 repetido; 201 reaproveita a marca global", async () => {
    const { POST, GET } = await import("@/app/api/admin/hackathons/[id]/sponsors/route");
    as(org);
    expect((await POST(req("POST", "{"), ctx())).status).toBe(400);
    expect((await POST(req("POST", { name: " " }), ctx())).status).toBe(400);
    expect((await POST(req("POST", { name: "C", logoUrl: "javascript:alert(1)" }), ctx())).status).toBe(400);
    expect((await POST(req("POST", { name: "C", tier: "ouro" }), ctx())).status).toBe(400);
    expect((await POST(req("POST", { name: "marca a" }), ctx())).status).toBe(409);
    // a mesma marca em outra edição é a mesma entidade
    await grantEditionRole(OTHER, org.id, "organizador", null);
    const res = await POST(req("POST", { name: "MARCA A", tier: "apoio" }), ctx(OTHER));
    expect(res.status).toBe(201);
    expect((await res.json()).sponsor).toMatchObject({ sponsorId: A, tier: "apoio" });
    const list = await (await GET(req("GET"), ctx())).json();
    expect(list.sponsors.map((s: { name: string }) => s.name)).toEqual(["Marca A", "Marca B"]);
  });

  it("PATCH liga desafio (só da edição) e categoria geral; 404 marca fora da edição", async () => {
    const { PATCH } = await import("@/app/api/admin/hackathons/[id]/sponsors/[sponsorId]/route");
    as(org);
    expect((await PATCH(req("PATCH", { challengeIds: ["chal-de-outra"] }), sctx(A))).status).toBe(400);
    expect((await PATCH(req("PATCH", {}), sctx(A))).status).toBe(400);
    expect((await PATCH(req("PATCH", { tier: "master" }), sctx("spon-nada"))).status).toBe(404);
    const cat = await db
      .prepare("INSERT INTO prize_categories (hackathonId, kind, name) VALUES (?, 'geral', 'Grande prêmio') RETURNING id")
      .get<{ id: number }>(H);
    const res = await PATCH(req("PATCH", { challengeIds: [chalA], categoryIds: [cat!.id] }), sctx(A));
    expect(res.status).toBe(200);
    const c = await db.prepare("SELECT sponsorId, sponsor FROM challenges WHERE id = ?").get(chalA);
    expect(c).toEqual({ sponsorId: A, sponsor: "Marca A" });
    const logos = await sponsorLogosForChallenges([chalA, "chal-spons-b"]);
    expect(logos.get(chalA)).toEqual({ name: "Marca A", logoUrl: "https://a.dev/logo.png", url: null });
    expect(logos.has("chal-spons-b")).toBe(false);
  });

  it("pessoas da marca: convite pra e-mail sem conta vale no primeiro login; 400 e-mail ruim", async () => {
    const { POST, GET, DELETE } = await import("@/app/api/admin/hackathons/[id]/sponsors/[sponsorId]/people/route");
    as(await member({ edition: "mentor" }));
    expect((await POST(req("POST", { email: "x@y.dev" }), sctx(A))).status).toBe(403);
    as(org);
    expect((await POST(req("POST", { email: "nada" }), sctx(A))).status).toBe(400);
    expect((await POST(req("POST", { email: "x@y.dev" }), sctx("spon-nada"))).status).toBe(404);
    const r = await POST(req("POST", { email: "Futura@Marca.dev" }), sctx(B));
    expect(await r.json()).toEqual({ result: "pending" });
    expect((await (await GET(req("GET"), sctx(B))).json()).invites[0].email).toBe("futura@marca.dev");
    const fut = await member();
    await db.prepare("UPDATE members SET email = 'futura@marca.dev' WHERE id = ?").run(fut.id);
    await claimSponsorInvites(fut.id, "futura@marca.dev");
    const after = await (await GET(req("GET"), sctx(B))).json();
    expect(after.invites).toEqual([]);
    expect(after.people.map((p: { memberId: number }) => p.memberId)).toEqual([fut.id]);
    expect((await DELETE(req("DELETE", { memberId: "x" }), sctx(B))).status).toBe(400);
    expect((await DELETE(req("DELETE", { memberId: fut.id }), sctx(B))).status).toBe(200);
  });
});

describe("relatório — isolamento entre marcas", () => {
  it("pessoa da marca A vê a A e leva 403 na B; anon 401; inscrito 403; marca fora 404", async () => {
    const { GET } = await import("@/app/api/admin/hackathons/[id]/sponsors/[sponsorId]/report/route");
    const { POST } = await import("@/app/api/admin/hackathons/[id]/sponsors/[sponsorId]/people/route");
    const pa = await member();
    as(org);
    expect(await (await POST(req("POST", { email: pa.email }), sctx(A))).json()).toEqual({ result: "granted" });
    as(null);
    expect((await GET(req("GET"), sctx(A))).status).toBe(401);
    as(await member({ status: "approved" }));
    expect((await GET(req("GET"), sctx(A))).status).toBe(403);
    as(pa);
    const ok = await GET(req("GET"), sctx(A));
    expect(ok.status).toBe(200);
    expect((await ok.json()).report.sponsor.name).toBe("Marca A");
    expect((await GET(req("GET"), sctx(B))).status).toBe(403);
    expect((await GET(req("GET"), sctx("spon-nada"))).status).toBe(404);
    // CSV também respeita o escopo
    expect((await GET(req("GET", undefined, "http://t/x?format=csv"), sctx(B))).status).toBe(403);
    const csv = await GET(req("GET", undefined, "http://t/x?format=csv"), sctx(A));
    expect(csv.headers.get("content-type")).toContain("text/csv");
    expect(await csv.text()).toContain("time,Time Alfa,Projeto Alfa,https://github.com/alfa,https://alfa.dev");
  });

  it("sem opt-in o relatório não tem dado pessoal (nem nome de integrante); júri sigiloso pra marca", async () => {
    const r = (await getSponsorReport(H, A, { manager: false }))!;
    // aprovados: integrante + 3 do beforeAll + 1 de cada teste de guarda acima; 1 pendente
    expect(r.funnel).toEqual({ inscritos: 7, aprovados: 6, confirmados: null, presentes: 1 });
    expect(r.profile.personas).toEqual([{ label: "desenvolvedor", n: 6 }]);
    expect(r.teams.map((t) => t.title)).toEqual(["Projeto Alfa"]);
    expect(r.stack.map((b) => b.label).sort()).toEqual(["Next.js", "Python"]);
    expect(r.talents).toEqual([]);
    expect(r.jury.visible).toBe(false);
    const json = JSON.stringify(r);
    expect(json).not.toMatch(/@t\.dev/);
    expect(json).not.toContain("Integrante Secreto");
    expect(json).not.toContain("linkedin.com");
    expect(json).not.toMatch(/"memberId"|"username"/);
    expect((await getSponsorReport(H, A, { manager: true }))!.jury.visible).toBe(true);
  });
});

describe("opt-in de contato por QR", () => {
  it("401 anon; 404 marca fora; 403 não aprovado; compartilha → aparece só na marca escolhida; revoga → some na hora", async () => {
    const { GET, POST, DELETE } = await import("@/app/api/hackathons/[id]/sponsors/[sponsorId]/contact/route");
    const r = await POST(req("POST"), sctx(A));
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: "Unauthorized" });
    expect((await GET(req("GET"), sctx(A))).status).toBe(401);
    as(await member({ status: "pending" }));
    expect((await POST(req("POST"), sctx(A))).status).toBe(403);
    const ana = await member({ status: "approved", name: "Ana Talento" });
    as(ana);
    expect((await POST(req("POST"), sctx("spon-nada"))).status).toBe(404);
    const before = await (await GET(req("GET"), sctx(A))).json();
    expect(before).toMatchObject({ eligible: true, sharedAt: null, sponsor: "Marca A" });
    expect(before.fields).toEqual(["nome", "e-mail", "LinkedIn", "GitHub", "projeto na edição"]);
    expect(before.preview.email).toBe(ana.email);

    const shared = await (await POST(req("POST"), sctx(A))).json();
    expect(shared.sharedAt).toMatch(/^\d{4}-\d{2}-\d{2} /);
    const first = shared.sharedAt;
    // repetir não muda a data do aceite (idempotente)
    expect((await (await POST(req("POST"), sctx(A))).json()).sharedAt).toBe(first);
    const repA = (await getSponsorReport(H, A, { manager: false }))!;
    expect(repA.talents).toEqual([
      expect.objectContaining({ name: "Ana Talento", email: ana.email, linkedin: expect.stringContaining("linkedin") }),
    ]);
    expect((await getSponsorReport(H, B, { manager: false }))!.talents).toEqual([]);

    const revoked = await (await DELETE(req("DELETE"), sctx(A))).json();
    expect(revoked.sharedAt).toBeNull();
    expect(revoked.revokedAt).toBeTruthy();
    expect((await getSponsorReport(H, A, { manager: false }))!.talents).toEqual([]);
    const row = await db
      .prepare("SELECT grantedAt, revokedAt FROM sponsor_contact_optins WHERE memberId = ?")
      .get<{ grantedAt: string; revokedAt: string | null }>(ana.id);
    expect(row?.revokedAt).toBeTruthy(); // fica registrado com data

    // reaceitar volta a aparecer
    await POST(req("POST"), sctx(A));
    expect((await getSponsorReport(H, A, { manager: true }))!.talents).toHaveLength(1);
  });

  it("entra no export LGPD e a exclusão da conta apaga o opt-in (e tira do relatório)", async () => {
    const bia = await member({ status: "approved", name: "Bia Exclui" });
    as(bia);
    const { POST } = await import("@/app/api/hackathons/[id]/sponsors/[sponsorId]/contact/route");
    await POST(req("POST"), sctx(B));
    const exp = await exportMemberData(bia.id);
    expect(exp!.data["sponsor_contact_optins.memberId"]).toEqual([
      expect.objectContaining({ hackathonId: H, sponsorId: B, revokedAt: null }),
    ]);
    expect((await getSponsorReport(H, B, { manager: true }))!.talents.map((t) => t.name)).toEqual(["Bia Exclui"]);
    await deleteMemberData(bia.id);
    const left = await db.prepare("SELECT 1 FROM sponsor_contact_optins WHERE memberId = ?").all(bia.id);
    expect(left).toEqual([]);
    expect((await getSponsorReport(H, B, { manager: true }))!.talents).toEqual([]);
  });
});

describe("remoção", () => {
  it("tirar a marca da edição leva acesso e opt-ins e desliga os desafios", async () => {
    const { DELETE } = await import("@/app/api/admin/hackathons/[id]/sponsors/[sponsorId]/route");
    as(await member({ edition: "jurado" }));
    expect((await DELETE(req("DELETE"), sctx(B))).status).toBe(403);
    as(org);
    expect((await DELETE(req("DELETE"), sctx(B))).status).toBe(200);
    expect((await DELETE(req("DELETE"), sctx(B))).status).toBe(404);
    const left = await db.prepare("SELECT 1 FROM edition_sponsor_members WHERE sponsorId = ?").all(B);
    expect(left).toEqual([]);
  });
});
