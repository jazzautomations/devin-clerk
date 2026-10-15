import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@clerk/nextjs/server";
import db from "@/lib/db";
import { createQuestion, submitRegistration } from "@/lib/registrationForm";
import { getEditionRoles } from "@/lib/roles";
import { setKindOpen } from "@/lib/roleApplications";
import { resetRateLimits } from "@/lib/ratelimit";

// frente E (spec 033) — candidatura por tipo pela API: 401/403/400/409 e
// o organizador aprovando (concede papel) ou recusando.

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(),
  currentUser: vi.fn(async () => null),
}));

type AuthResult = Awaited<ReturnType<typeof auth>>;
const asUser = (id: string | null) => vi.mocked(auth).mockResolvedValue({ userId: id } as AuthResult);

const ED = "cand-api";

const req = (method: string, body?: unknown, url = "http://t") =>
  new Request(url, {
    method,
    headers: { "Content-Type": "application/json", "x-forwarded-for": "177.1.1.1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const kindCtx = (kind: string) => ({ params: Promise.resolve({ id: ED, kind }) });
const edCtx = { params: Promise.resolve({ id: ED }) };
const appCtx = (applicationId: number | string) => ({ params: Promise.resolve({ id: ED, applicationId: String(applicationId) }) });

async function idOf(clerkId: string) {
  return (await db.prepare("SELECT id FROM members WHERE clerkId = ?").get<{ id: number }>(clerkId))!.id;
}

beforeEach(async () => {
  resetRateLimits();
  for (const [c, u] of [
    ["clerk_ca_usr", "ca_usr"],
    ["clerk_ca_usr2", "ca_usr2"],
    ["clerk_ca_org", "ca_org"],
    ["clerk_ca_out", "ca_out"],
  ]) {
    await db
      .prepare("INSERT OR IGNORE INTO members (clerkId, username, email) VALUES (?, ?, ?)")
      .run(c, u, `${u}@t.dev`);
  }
  await db
    .prepare(
      `INSERT OR IGNORE INTO hackathons (id, name, organizer, startsAt, format, registrationUrl, tags, source)
       VALUES (?, 'Cand API', 'Hack Inova', '2099-05-01', 'online', 'https://x.dev', '[]', 'painel')`,
    )
    .run(ED);
  for (const t of ["role_applications", "registrations", "edition_questions", "consents", "edition_open_kinds", "edition_roles"]) {
    await db.prepare(`DELETE FROM ${t} WHERE hackathonId = ?`).run(ED);
  }
  await db
    .prepare("INSERT INTO edition_roles (hackathonId, memberId, role) VALUES (?, ?, 'organizador')")
    .run(ED, await idOf("clerk_ca_org"));
  await setKindOpen(ED, "mentor", true, null);
  await setKindOpen(ED, "jurado", true, null);
});

describe("POST /api/hackathons/[id]/applications/[kind]", () => {
  it("anon → 401 JSON", async () => {
    asUser(null);
    const { POST, GET, DELETE } = await import("@/app/api/hackathons/[id]/applications/[kind]/route");
    for (const res of [
      await POST(req("POST", { consent: true }), kindCtx("mentor")),
      await GET(req("GET"), kindCtx("mentor")),
      await DELETE(req("DELETE"), kindCtx("mentor")),
    ]) {
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "Unauthorized" });
    }
  });

  it("tipo inexistente → 404; tipo fechado → 403", async () => {
    asUser("clerk_ca_usr");
    const { POST } = await import("@/app/api/hackathons/[id]/applications/[kind]/route");
    expect((await POST(req("POST", { consent: true }), kindCtx("participante"))).status).toBe(404);
    const closed = await POST(req("POST", { consent: true }), kindCtx("voluntario"));
    expect(closed.status).toBe(403);
    expect((await closed.json()).error).toBe("kind_closed");
  });

  it("sem consentimento ou obrigatória vazia → 400; válido → 201; repetido → 409", async () => {
    asUser("clerk_ca_usr");
    const q = await createQuestion(ED, { kind: "short_text", label: "Área", required: true, audience: "mentor" });
    const { POST, GET } = await import("@/app/api/hackathons/[id]/applications/[kind]/route");
    const noConsent = await POST(req("POST", { answers: { [q.id]: "web" } }), kindCtx("mentor"));
    expect(noConsent.status).toBe(400);
    expect((await noConsent.json()).error).toBe("consent_required");
    const empty = await POST(req("POST", { consent: true, answers: {} }), kindCtx("mentor"));
    expect(empty.status).toBe(400);
    expect((await empty.json()).questionId).toBe(q.id);
    const ok = await POST(req("POST", { consent: true, answers: { [q.id]: "web" } }), kindCtx("mentor"));
    expect(ok.status).toBe(201);
    expect(await ok.json()).toMatchObject({ kind: "mentor", status: "pending" });
    const dup = await POST(req("POST", { consent: true, answers: { [q.id]: "web" } }), kindCtx("mentor"));
    expect(dup.status).toBe(409);
    expect(await dup.json()).toMatchObject({ error: "duplicate", status: "pending" });
    expect(await (await GET(req("GET"), kindCtx("mentor"))).json()).toEqual({ kind: "mentor", status: "pending" });
    const c = await db
      .prepare("SELECT ip, scope FROM consents WHERE memberId = ? AND hackathonId = ?")
      .get<{ ip: string; scope: string }>(await idOf("clerk_ca_usr"), ED);
    expect(c).toEqual({ ip: "177.1.1.1", scope: "mentor" });
  });

  it("participante inscrito → 409 conflict_participant ao pedir jurado", async () => {
    await submitRegistration({ memberId: await idOf("clerk_ca_usr"), hackathonId: ED, answers: {}, consent: true, ip: null, terms: { birthDate: "2000-01-01", conduct: true } });
    asUser("clerk_ca_usr");
    const { POST } = await import("@/app/api/hackathons/[id]/applications/[kind]/route");
    const res = await POST(req("POST", { consent: true }), kindCtx("jurado"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("conflict_participant");
  });

  it("candidato a jurado que tenta se inscrever como participante → 409", async () => {
    asUser("clerk_ca_usr");
    const { POST } = await import("@/app/api/hackathons/[id]/applications/[kind]/route");
    expect((await POST(req("POST", { consent: true }), kindCtx("jurado"))).status).toBe(201);
    const reg = await import("@/app/api/hackathons/[id]/register/route");
    const res = await reg.POST(req("POST", { consent: true, terms: { birthDate: "2000-01-01", conduct: true } }), edCtx);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("conflict_role:jurado");
  });

  it("DELETE retira a pendente (200) e depois 404", async () => {
    asUser("clerk_ca_usr");
    const { POST, DELETE } = await import("@/app/api/hackathons/[id]/applications/[kind]/route");
    await POST(req("POST", { consent: true }), kindCtx("mentor"));
    expect((await DELETE(req("DELETE"), kindCtx("mentor"))).status).toBe(200);
    expect((await DELETE(req("DELETE"), kindCtx("mentor"))).status).toBe(404);
  });

  it("rate limit: 11ª escrita na hora → 429", async () => {
    asUser("clerk_ca_usr");
    const { POST } = await import("@/app/api/hackathons/[id]/applications/[kind]/route");
    for (let i = 0; i < 10; i++) await POST(req("POST", { consent: true }), kindCtx("mentor"));
    expect((await POST(req("POST", { consent: true }), kindCtx("mentor"))).status).toBe(429);
  });
});

describe("/api/admin/hackathons/[id]/applications", () => {
  it("anon 401, membro sem papel 403, organizador lista e abre/fecha tipos", async () => {
    const { GET, PUT } = await import("@/app/api/admin/hackathons/[id]/applications/route");
    asUser(null);
    expect((await GET(req("GET"), edCtx)).status).toBe(401);
    expect((await PUT(req("PUT", { kind: "mentor", open: false }), edCtx)).status).toBe(401);
    asUser("clerk_ca_out");
    expect((await GET(req("GET"), edCtx)).status).toBe(403);
    expect((await PUT(req("PUT", { kind: "mentor", open: false }), edCtx)).status).toBe(403);
    asUser("clerk_ca_org");
    expect((await PUT(req("PUT", { kind: "staff", open: true }), edCtx)).status).toBe(400);
    const put = await PUT(req("PUT", { kind: "voluntario", open: true }), edCtx);
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ open: ["voluntario", "mentor", "jurado"] });
    expect((await GET(req("GET", undefined, "http://t/?kind=nada"), edCtx)).status).toBe(400);
    const list = await GET(req("GET", undefined, "http://t/?kind=mentor"), edCtx);
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({ applications: [], open: ["voluntario", "mentor", "jurado"] });
  });

  it("PATCH aprovar concede papel; recusar não; já decidida 409; guardas 401/403/400/404", async () => {
    asUser("clerk_ca_usr");
    const cand = await import("@/app/api/hackathons/[id]/applications/[kind]/route");
    const a = await (await cand.POST(req("POST", { consent: true }), kindCtx("jurado"))).json();
    asUser("clerk_ca_usr2");
    const b = await (await cand.POST(req("POST", { consent: true }), kindCtx("mentor"))).json();

    const { PATCH } = await import("@/app/api/admin/hackathons/[id]/applications/[applicationId]/route");
    asUser(null);
    expect((await PATCH(req("PATCH", { action: "approve" }), appCtx(a.id))).status).toBe(401);
    asUser("clerk_ca_usr2");
    expect((await PATCH(req("PATCH", { action: "approve" }), appCtx(a.id))).status).toBe(403);
    asUser("clerk_ca_org");
    expect((await PATCH(req("PATCH", { action: "talvez" }), appCtx(a.id))).status).toBe(400);
    expect((await PATCH(req("PATCH", { action: "approve" }), appCtx(999999))).status).toBe(404);
    expect((await PATCH(req("PATCH", { action: "approve" }), appCtx("abc"))).status).toBe(404);

    const ok = await PATCH(req("PATCH", { action: "approve" }), appCtx(a.id));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, status: "approved", role: "jurado" });
    expect(await getEditionRoles(ED, await idOf("clerk_ca_usr"))).toEqual(["jurado"]);

    const no = await PATCH(req("PATCH", { action: "reject", note: "fechamos a mentoria" }), appCtx(b.id));
    expect(await no.json()).toEqual({ ok: true, status: "rejected" });
    expect(await getEditionRoles(ED, await idOf("clerk_ca_usr2"))).toEqual([]);

    expect((await PATCH(req("PATCH", { action: "approve" }), appCtx(b.id))).status).toBe(409);
  });
});

describe("/api/admin/hackathons/[id]/questions — público", () => {
  it("cria e lista por público; público inválido → 400", async () => {
    asUser("clerk_ca_org");
    const { GET, POST } = await import("@/app/api/admin/hackathons/[id]/questions/route");
    const created = await POST(req("POST", { kind: "short_text", label: "Disponibilidade", audience: "voluntario" }), edCtx);
    expect(created.status).toBe(201);
    expect((await created.json()).question.audience).toBe("voluntario");
    expect((await POST(req("POST", { kind: "short_text", label: "x", audience: "staff" }), edCtx)).status).toBe(400);
    const vol = await (await GET(req("GET", undefined, "http://t/?audience=voluntario"), edCtx)).json();
    expect(vol.questions.map((q: { label: string }) => q.label)).toEqual(["Disponibilidade"]);
    const part = await (await GET(req("GET"), edCtx)).json();
    expect(part.questions).toEqual([]);
    expect((await GET(req("GET", undefined, "http://t/?audience=nada"), edCtx)).status).toBe(400);
  });
});
