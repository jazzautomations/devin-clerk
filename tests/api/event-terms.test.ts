import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@clerk/nextjs/server";
import db from "@/lib/db";
import { grantEditionRole } from "@/lib/roles";
import { resetRateLimits } from "@/lib/ratelimit";
import { getRegistrationStatus } from "@/lib/registrations";
import { saveEditionTerms } from "@/lib/eventTerms";

// frente L pela API — inscrição com idade/responsável/conduta, uso de imagem
// revogável, canal de incidentes (anônimo), fila privada, termos e refeições.

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
  currentUser: vi.fn(async () => null),
}));

type AuthResult = Awaited<ReturnType<typeof auth>>;
const asUser = (id: string | null) => vi.mocked(auth).mockResolvedValue({ userId: id } as AuthResult);

const ED = "terms-api";
const ctx = () => ({ params: Promise.resolve({ id: ED }) });
const incCtx = (incidentId: string) => ({ params: Promise.resolve({ id: ED, incidentId }) });
const req = (method: string, body?: unknown, url = "http://t/", headers: Record<string, string> = {}) =>
  new Request(url, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

async function idOf(clerkId: string) {
  return (await db.prepare("SELECT id FROM members WHERE clerkId = ?").get<{ id: number }>(clerkId))!.id;
}

const ADULT = { birthDate: "2000-01-01", conduct: true };
// edição daqui a 30 dias: dá pra ter menor com data de nascimento no passado
const START = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
const yearsBefore = (n: number) => `${Number(START.slice(0, 4)) - n}${START.slice(4)}`;

beforeEach(async () => {
  resetRateLimits();
  for (const u of ["usr", "teen", "org", "staff", "handler", "out"]) {
    await db
      .prepare("INSERT OR IGNORE INTO members (clerkId, username, email) VALUES (?, ?, ?)")
      .run(`clerk_t_${u}`, `t_${u}`, `t_${u}@t.dev`);
  }
  await db
    .prepare(
      `INSERT OR IGNORE INTO hackathons (id, name, organizer, startsAt, format, registrationUrl, tags)
       VALUES (?, 'Terms API', 'Hack Inova', ?, 'presencial', 'https://x.dev', '[]')`,
    )
    .run(ED, START);
  await db.prepare("DELETE FROM registrations WHERE hackathonId = ?").run(ED);
  await db.prepare("DELETE FROM incidents WHERE hackathonId = ?").run(ED);
  await db.prepare("DELETE FROM edition_terms WHERE hackathonId = ?").run(ED);
  await db.prepare("DELETE FROM edition_conduct_handlers WHERE hackathonId = ?").run(ED);
  await grantEditionRole(ED, await idOf("clerk_t_org"), "organizador", null);
  await grantEditionRole(ED, await idOf("clerk_t_staff"), "staff", null);
  await grantEditionRole(ED, await idOf("clerk_t_handler"), "staff", null);
});

describe("POST /register com termos do evento", () => {
  it("sem data de nascimento → 400 birth_date_required", async () => {
    asUser("clerk_t_usr");
    const { POST } = await import("@/app/api/hackathons/[id]/register/route");
    const res = await POST(req("POST", { consent: true, terms: { conduct: true } }), ctx());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("birth_date_required");
  });

  it("sem aceite do código de conduta → 400 conduct_required", async () => {
    asUser("clerk_t_usr");
    const { POST } = await import("@/app/api/hackathons/[id]/register/route");
    const res = await POST(req("POST", { consent: true, terms: { birthDate: "2000-01-01" } }), ctx());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("conduct_required");
  });

  it("menor numa edição 18+ → 400 com mensagem clara e nada gravado", async () => {
    asUser("clerk_t_teen");
    const { POST } = await import("@/app/api/hackathons/[id]/register/route");
    const res = await POST(req("POST", { consent: true, terms: { birthDate: yearsBefore(17), conduct: true } }), ctx());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("under_min_age:18");
    expect(body.message).toMatch(/18 anos ou mais/);
    expect(await getRegistrationStatus(await idOf("clerk_t_teen"), ED)).toBeNull();
  });

  it("edição 16+: menor sem responsável → 400; com responsável → 200 e responsável gravado", async () => {
    await saveEditionTerms(ED, { minAge: 16 }, null);
    asUser("clerk_t_teen");
    const { POST } = await import("@/app/api/hackathons/[id]/register/route");
    const teen = { birthDate: yearsBefore(17), conduct: true }; // 17 no dia do evento
    const no = await POST(req("POST", { consent: true, terms: teen }), ctx());
    expect(no.status).toBe(400);
    expect((await no.json()).error).toBe("guardian_required");
    const ok = await POST(
      req("POST", {
        consent: true,
        terms: { ...teen, guardian: { name: "Rita Responsável", email: "rita@resp.dev", accepted: true } },
      }),
      ctx(),
    );
    expect(ok.status).toBe(200);
    expect((await ok.json()).status).toBe("approved");
    const t = await db
      .prepare("SELECT guardianEmail, guardianEmailStatus, ageAtEvent FROM registration_terms WHERE memberId = ?")
      .get<Record<string, unknown>>(await idOf("clerk_t_teen"));
    expect(t).toMatchObject({ guardianEmail: "rita@resp.dev", guardianEmailStatus: "skipped", ageAtEvent: 17 });
  });

  it("adulto com tudo certo → 200; recusar imagem não impede a inscrição", async () => {
    asUser("clerk_t_usr");
    const { POST } = await import("@/app/api/hackathons/[id]/register/route");
    const res = await POST(req("POST", { consent: true, terms: { ...ADULT, imageUse: false } }), ctx());
    expect(res.status).toBe(200);
    expect((await res.json()).registered).toBe(true);
  });
});

describe("POST /image-consent — revogação pelo próprio inscrito", () => {
  it("401 anon, 403 não inscrito, 400 corpo inválido, 200 autoriza e revoga com histórico", async () => {
    const { POST, GET } = await import("@/app/api/hackathons/[id]/image-consent/route");
    asUser(null);
    expect((await POST(req("POST", { granted: true }), ctx())).status).toBe(401);
    asUser("clerk_t_out");
    expect((await POST(req("POST", { granted: true }), ctx())).status).toBe(403);

    asUser("clerk_t_usr");
    const reg = await import("@/app/api/hackathons/[id]/register/route");
    await reg.POST(req("POST", { consent: true, terms: { ...ADULT, imageUse: true } }), ctx());
    expect((await POST(req("POST", { granted: "sim" }), ctx())).status).toBe(400);
    const rev = await POST(req("POST", { granted: false, source: "perfil" }), ctx());
    expect(rev.status).toBe(200);
    expect((await rev.json()).granted).toBe(false);
    const hist = await (await GET(req("GET"), ctx())).json();
    expect(hist.granted).toBe(false);
    expect(hist.history.map((h: { granted: boolean; source: string }) => [h.granted, h.source])).toEqual([
      [true, "inscricao"],
      [false, "perfil"],
    ]);
  });
});

describe("POST /incidents — canal de denúncia", () => {
  it("anon → 201 sem autor; corpo inválido → 400; logado com anonymous=true não grava autor", async () => {
    const { POST } = await import("@/app/api/hackathons/[id]/incidents/route");
    asUser(null);
    const bad = await POST(req("POST", { kind: "assedio", description: "x" }), ctx());
    expect(bad.status).toBe(400);
    const anon = await POST(
      req("POST", { kind: "assedio", description: "comentário ofensivo no corredor", location: "sala 2" }, "http://t/", {
        "x-forwarded-for": "177.1.1.1",
      }),
      ctx(),
    );
    expect(anon.status).toBe(201);
    expect((await anon.json()).anonymous).toBe(true);

    asUser("clerk_t_usr");
    await POST(req("POST", { kind: "saude", description: "pessoa passando mal no lab", anonymous: true }), ctx());
    await POST(req("POST", { kind: "outro", description: "relato identificado aqui" }), ctx());
    const rows = await db
      .prepare("SELECT reporterId FROM incidents WHERE hackathonId = ? ORDER BY id")
      .all<{ reporterId: number | null }>(ED);
    expect(rows.map((r) => r.reporterId)).toEqual([null, null, await idOf("clerk_t_usr")]);
  });

  it("anônimo no mesmo wifi (NAT): 10 denúncias do mesmo IP passam; teto é 20/h por IP e edição", async () => {
    // auditoria 041 incidente-anonimo-nat: com 3/h por IP, a 4ª vítima no
    // mesmo wifi do evento levava 429
    const { POST } = await import("@/app/api/hackathons/[id]/incidents/route");
    asUser(null);
    const send = () =>
      POST(
        req("POST", { kind: "outro", description: "relato de quem está no wifi do evento" }, "http://t/", {
          "x-forwarded-for": "10.9.9.9",
        }),
        ctx(),
      );
    for (let i = 0; i < 10; i++) expect((await send()).status).toBe(201);
    for (let i = 10; i < 20; i++) expect((await send()).status).toBe(201);
    expect((await send()).status).toBe(429);
  });

  it("logado continua com 3/h por membro", async () => {
    const { POST } = await import("@/app/api/hackathons/[id]/incidents/route");
    asUser("clerk_t_usr");
    const send = () => POST(req("POST", { kind: "outro", description: "relato identificado aqui" }), ctx());
    for (let i = 0; i < 3; i++) expect((await send()).status).toBe(201);
    expect((await send()).status).toBe(429);
  });

  it("honeypot preenchido responde 201 e não grava", async () => {
    const { POST } = await import("@/app/api/hackathons/[id]/incidents/route");
    asUser(null);
    const res = await POST(
      req("POST", { kind: "outro", description: "robô preenchendo tudo", website: "http://spam" }, "http://t/", {
        "x-forwarded-for": "10.7.7.7",
      }),
      ctx(),
    );
    expect(res.status).toBe(201);
    const n = await db.prepare("SELECT COUNT(*)::int AS n FROM incidents WHERE hackathonId = ?").get<{ n: number }>(ED);
    expect(Number(n?.n)).toBe(0);
  });

  it("edição inexistente → 404", async () => {
    const { POST } = await import("@/app/api/hackathons/[id]/incidents/route");
    asUser(null);
    const res = await POST(req("POST", { kind: "outro", description: "algo aconteceu aqui" }), {
      params: Promise.resolve({ id: "nao-existe" }),
    });
    expect(res.status).toBe(404);
  });
});

describe("fila de incidentes no painel", () => {
  it("401 anon, 403 staff, 200 organizador; responsável marcado passa a ver; PATCH 400/200", async () => {
    const pub = await import("@/app/api/hackathons/[id]/incidents/route");
    asUser(null);
    await pub.POST(req("POST", { kind: "seguranca", description: "mochila sumiu da sala 3" }), ctx());
    const { GET } = await import("@/app/api/admin/hackathons/[id]/incidents/route");
    const { PATCH } = await import("@/app/api/admin/hackathons/[id]/incidents/[incidentId]/route");
    const handlers = await import("@/app/api/admin/hackathons/[id]/incidents/handlers/route");

    expect((await GET(req("GET"), ctx())).status).toBe(401);
    asUser("clerk_t_staff");
    expect((await GET(req("GET"), ctx())).status).toBe(403);
    asUser("clerk_t_handler");
    expect((await GET(req("GET"), ctx())).status).toBe(403);
    // staff não marca responsável
    expect((await handlers.PUT(req("PUT", { memberId: await idOf("clerk_t_handler"), on: true }), ctx())).status).toBe(403);

    asUser("clerk_t_org");
    const list = await (await GET(req("GET"), ctx())).json();
    expect(list.incidents).toHaveLength(1);
    expect(list.incidents[0]).toMatchObject({ kind: "seguranca", anonymous: true, status: "aberto" });
    expect((await handlers.PUT(req("PUT", { memberId: "x", on: true }), ctx())).status).toBe(400);
    expect((await handlers.PUT(req("PUT", { memberId: await idOf("clerk_t_out"), on: true }), ctx())).status).toBe(400);
    expect((await handlers.PUT(req("PUT", { memberId: await idOf("clerk_t_handler"), on: true }), ctx())).status).toBe(200);

    asUser("clerk_t_handler");
    expect((await GET(req("GET"), ctx())).status).toBe(200);
    const id = String(list.incidents[0].id);
    expect((await PATCH(req("PATCH", { status: "fechado" }), incCtx(id))).status).toBe(400);
    expect((await PATCH(req("PATCH", { status: "em_andamento", internalNote: "achamos" }), incCtx(id))).status).toBe(200);
    expect((await PATCH(req("PATCH", { status: "resolvido" }), incCtx("999999"))).status).toBe(404);
    asUser("clerk_t_staff");
    expect((await PATCH(req("PATCH", { status: "resolvido" }), incCtx(id))).status).toBe(403);
  });
});

describe("PUT /admin/…/terms", () => {
  it("401 anon, 403 staff, 400 idade inválida, 200 salva", async () => {
    const { PUT, GET } = await import("@/app/api/admin/hackathons/[id]/terms/route");
    asUser(null);
    expect((await PUT(req("PUT", { minAge: 16 }), ctx())).status).toBe(401);
    asUser("clerk_t_staff");
    expect((await PUT(req("PUT", { minAge: 16 }), ctx())).status).toBe(403);
    asUser("clerk_t_org");
    expect((await PUT(req("PUT", { minAge: 10 }), ctx())).status).toBe(400);
    const ok = await PUT(req("PUT", { minAge: 16, dietEnabled: true }), ctx());
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ minAge: 16, dietEnabled: true, allowsMinors: true });
    expect((await (await GET(req("GET"), ctx())).json()).minAge).toBe(16);
  });
});

describe("GET /admin/…/refeicoes", () => {
  it("401 anon, 403 fora da equipe, 200 staff (JSON e CSV)", async () => {
    await saveEditionTerms(ED, { dietEnabled: true }, null);
    asUser("clerk_t_usr");
    const reg = await import("@/app/api/hackathons/[id]/register/route");
    await reg.POST(req("POST", { consent: true, terms: { ...ADULT, diet: ["vegano"], allergies: "nozes", allergySevere: true } }), ctx());
    const { GET } = await import("@/app/api/admin/hackathons/[id]/refeicoes/route");
    asUser(null);
    expect((await GET(req("GET"), ctx())).status).toBe(401);
    asUser("clerk_t_out");
    expect((await GET(req("GET"), ctx())).status).toBe(403);
    asUser("clerk_t_staff");
    const json = await (await GET(req("GET"), ctx())).json();
    expect(json).toMatchObject({ total: 1, counts: { vegano: 1 } });
    expect(json.allergies[0]).toMatchObject({ text: "nozes", severe: true });
    const csv = await GET(req("GET", undefined, "http://t/?format=csv&presentes=1"), ctx());
    expect(csv.headers.get("content-type")).toContain("text/csv");
    expect(await csv.text()).toContain("total,0");
  });
});
