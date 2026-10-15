import { beforeEach, describe, expect, it } from "vitest";
import db from "@/lib/db";
import {
  applyForRole,
  getMyApplications,
  getOpenKinds,
  listApplications,
  reviewApplication,
  setKindOpen,
  withdrawApplication,
} from "@/lib/roleApplications";
import {
  consentPurpose,
  countCurrentAnswers,
  createQuestion,
  hasActiveQuestions,
  listQuestions,
  moveQuestion,
  submitRegistration,
  updateQuestion,
} from "@/lib/registrationForm";
import { getEditionRoles, grantEditionRole } from "@/lib/roles";
import { listNotifications } from "@/lib/notifications";

// frente E (spec 033) — candidatura por tipo: voluntário, mentor, jurado.

const ED = "cand-ut";
let seq = 0;

async function makeMember(): Promise<number> {
  seq++;
  const clerk = `c_cand_${seq}_${Date.now()}`;
  await db
    .prepare("INSERT INTO members (clerkId, username, email) VALUES (?, ?, ?)")
    .run(clerk, `ucand${seq}_${Date.now() % 100000}`, `${clerk}@t.dev`);
  return (await db.prepare("SELECT id FROM members WHERE clerkId = ?").get<{ id: number }>(clerk))!.id;
}

const apply = (memberId: number, kind: "voluntario" | "mentor" | "jurado", extra: Record<string, unknown> = {}) =>
  applyForRole({ memberId, hackathonId: ED, kind, answers: {}, consent: true, ip: "10.0.0.1", ...extra });

const idOf = async (memberId: number, kind: string) =>
  (await db
    .prepare("SELECT id FROM role_applications WHERE hackathonId = ? AND memberId = ? AND kind = ?")
    .get<{ id: number }>(ED, memberId, kind))!.id;

beforeEach(async () => {
  await db
    .prepare(
      `INSERT OR IGNORE INTO hackathons (id, name, organizer, startsAt, format, registrationUrl, tags, source)
       VALUES (?, 'Cand UT', 'Hack Inova', '2099-03-01', 'presencial', 'https://x.dev', '[]', 'painel')`,
    )
    .run(ED);
  await db.prepare("DELETE FROM role_applications WHERE hackathonId = ?").run(ED);
  await db.prepare("DELETE FROM registrations WHERE hackathonId = ?").run(ED);
  await db.prepare("DELETE FROM edition_questions WHERE hackathonId = ?").run(ED);
  await db.prepare("DELETE FROM edition_roles WHERE hackathonId = ?").run(ED);
  await db.prepare("DELETE FROM consents WHERE hackathonId = ?").run(ED);
  await db.prepare("DELETE FROM edition_open_kinds WHERE hackathonId = ?").run(ED);
  for (const k of ["voluntario", "mentor", "jurado"] as const) await setKindOpen(ED, k, true, null);
});

describe("tipos abertos", () => {
  it("organizador liga/desliga por edição; ordem estável", async () => {
    expect(await getOpenKinds(ED)).toEqual(["voluntario", "mentor", "jurado"]);
    expect(await setKindOpen(ED, "mentor", false, null)).toEqual(["voluntario", "jurado"]);
    expect(await setKindOpen(ED, "mentor", true, null)).toEqual(["voluntario", "mentor", "jurado"]);
    expect(await setKindOpen(ED, "mentor", true, null)).toEqual(["voluntario", "mentor", "jurado"]);
  });

  it("tipo fechado recusa candidatura", async () => {
    await setKindOpen(ED, "jurado", false, null);
    const m = await makeMember();
    expect(await apply(m, "jurado")).toMatchObject({ ok: false, error: "kind_closed" });
    expect(await getMyApplications(m, ED)).toEqual({});
  });
});

describe("candidatar", () => {
  it("cria pendente com consentimento de finalidade própria; duplicada é recusada com o status", async () => {
    const m = await makeMember();
    expect(await apply(m, "mentor")).toMatchObject({ ok: true, status: "pending" });
    expect(await apply(m, "mentor")).toMatchObject({ ok: false, error: "duplicate", status: "pending" });
    expect(await getMyApplications(m, ED)).toEqual({ mentor: "pending" });
    const c = await db
      .prepare("SELECT scope, purpose, ip FROM consents WHERE memberId = ? AND hackathonId = ?")
      .get<{ scope: string; purpose: string; ip: string }>(m, ED);
    expect(c).toMatchObject({ scope: "mentor", ip: "10.0.0.1" });
    expect(c!.purpose).toContain("candidatura a mentor");
    // pode se candidatar a outro tipo
    expect(await apply(m, "voluntario")).toMatchObject({ ok: true });
  });

  it("sem consentimento → consent_required e nada gravado", async () => {
    const m = await makeMember();
    expect(await apply(m, "voluntario", { consent: false })).toMatchObject({ ok: false, error: "consent_required" });
    expect(await getMyApplications(m, ED)).toEqual({});
  });

  it("aceite de participante não vale como aceite de candidatura", async () => {
    const m = await makeMember();
    await db
      .prepare("INSERT INTO consents (memberId, hackathonId, termsVersion, purpose) VALUES (?, ?, '2026-10-14', 'x')")
      .run(m, ED);
    expect(await apply(m, "voluntario", { consent: false })).toMatchObject({ ok: false, error: "consent_required" });
  });

  it("valida o formulário DAQUELE tipo (obrigatória do mentor não vale pro voluntário)", async () => {
    const q = await createQuestion(ED, { kind: "short_text", label: "Área", required: true, audience: "mentor" });
    const a = await makeMember();
    expect(await apply(a, "mentor")).toMatchObject({ ok: false, error: "invalid_answer", questionId: q.id });
    expect(await apply(a, "voluntario")).toMatchObject({ ok: true });
    expect(await apply(a, "mentor", { answers: { [q.id]: "backend" } })).toMatchObject({ ok: true });
    const list = await listApplications(ED, "mentor");
    expect(list).toHaveLength(1);
    expect(list[0].answers).toEqual([{ questionId: q.id, questionVersion: 1, label: "Área", value: "backend" }]);
  });

  it("quem já tem o papel não se candidata a ele", async () => {
    const m = await makeMember();
    await grantEditionRole(ED, m, "mentor", null);
    expect(await apply(m, "mentor")).toMatchObject({ ok: false, error: "already_has_role" });
  });

  it("retirar só a pendente", async () => {
    const m = await makeMember();
    await apply(m, "mentor");
    expect(await withdrawApplication(m, ED, "mentor")).toBe("withdrawn");
    expect(await withdrawApplication(m, ED, "mentor")).toBe("not_found");
    await apply(m, "jurado");
    await reviewApplication({ hackathonId: ED, applicationId: await idOf(m, "jurado"), action: "reject", reviewerId: null });
    expect(await withdrawApplication(m, ED, "jurado")).toBe("already_reviewed");
  });
});

describe("conflito participante × ajuda", () => {
  it("inscrito (aprovado, pendente ou na fila) não se candidata a jurado nem aos outros tipos", async () => {
    const m = await makeMember();
    expect(await submitRegistration({ memberId: m, hackathonId: ED, answers: {}, consent: true, ip: null, terms: { birthDate: "2000-01-01", conduct: true } })).toMatchObject({
      ok: true,
    });
    for (const k of ["jurado", "mentor", "voluntario"] as const) {
      expect(await apply(m, k)).toMatchObject({ ok: false, error: "conflict_participant" });
    }
  });

  it("inscrição recusada não bloqueia candidatura", async () => {
    const m = await makeMember();
    await db
      .prepare("INSERT INTO registrations (memberId, hackathonId, status) VALUES (?, ?, 'rejected')")
      .run(m, ED);
    expect(await apply(m, "voluntario")).toMatchObject({ ok: true });
  });

  it("candidato pendente/aprovado não se inscreve como participante; recusado pode", async () => {
    const m = await makeMember();
    await apply(m, "jurado");
    expect(await submitRegistration({ memberId: m, hackathonId: ED, answers: {}, consent: true, ip: null, terms: { birthDate: "2000-01-01", conduct: true } })).toMatchObject({
      ok: false,
      error: "conflict_role:jurado",
    });
    await reviewApplication({ hackathonId: ED, applicationId: await idOf(m, "jurado"), action: "reject", reviewerId: null });
    expect(await submitRegistration({ memberId: m, hackathonId: ED, answers: {}, consent: true, ip: null, terms: { birthDate: "2000-01-01", conduct: true } })).toMatchObject({
      ok: true,
      created: true,
    });
  });

  it("jurado convidado (sem candidatura) também não se inscreve", async () => {
    const m = await makeMember();
    await grantEditionRole(ED, m, "jurado", null);
    expect(await submitRegistration({ memberId: m, hackathonId: ED, answers: {}, consent: true, ip: null, terms: { birthDate: "2000-01-01", conduct: true } })).toMatchObject({
      ok: false,
      error: "conflict_role:jurado",
    });
  });

  it("aprovar candidatura de quem virou participante no meio do caminho é recusado", async () => {
    const m = await makeMember();
    await apply(m, "mentor");
    await db.prepare("INSERT INTO registrations (memberId, hackathonId, status) VALUES (?, ?, 'approved')").run(m, ED);
    const r = await reviewApplication({ hackathonId: ED, applicationId: await idOf(m, "mentor"), action: "approve", reviewerId: null });
    expect(r).toEqual({ ok: false, error: "conflict_participant" });
    expect(await getEditionRoles(ED, m)).toEqual([]);
  });
});

describe("decisão do organizador", () => {
  it.each([
    ["voluntario", "staff"],
    ["mentor", "mentor"],
    ["jurado", "jurado"],
  ] as const)("aprovar %s concede o papel %s e notifica", async (kind, role) => {
    const org = await makeMember();
    const m = await makeMember();
    await apply(m, kind);
    const r = await reviewApplication({ hackathonId: ED, applicationId: await idOf(m, kind), action: "approve", reviewerId: org });
    expect(r).toEqual({ ok: true, status: "approved", role });
    expect(await getEditionRoles(ED, m)).toEqual([role]);
    const [n] = await listNotifications(m);
    expect(n).toMatchObject({ type: "role_application_approved", href: `/admin/h/${ED}` });
    const [view] = await listApplications(ED, kind);
    expect(view).toMatchObject({ status: "approved", reviewedBy: expect.any(String) });
    expect(view.reviewedAt).not.toBeNull();
  });

  it("recusar não concede papel, notifica e é final", async () => {
    const m = await makeMember();
    await apply(m, "jurado");
    const id = await idOf(m, "jurado");
    const r = await reviewApplication({ hackathonId: ED, applicationId: id, action: "reject", reviewerId: null, note: "sem vaga" });
    expect(r).toEqual({ ok: true, status: "rejected" });
    expect(await getEditionRoles(ED, m)).toEqual([]);
    expect((await listNotifications(m))[0]).toMatchObject({ type: "role_application_rejected" });
    expect(await reviewApplication({ hackathonId: ED, applicationId: id, action: "approve", reviewerId: null })).toEqual({
      ok: false,
      error: "already_reviewed",
    });
    expect(await getEditionRoles(ED, m)).toEqual([]);
    expect((await listApplications(ED))[0]).toMatchObject({ status: "rejected", note: "sem vaga" });
  });

  it("candidatura de outra edição = not_found", async () => {
    const m = await makeMember();
    await apply(m, "mentor");
    const r = await reviewApplication({
      hackathonId: "outra-edicao",
      applicationId: await idOf(m, "mentor"),
      action: "approve",
      reviewerId: null,
    });
    expect(r).toEqual({ ok: false, error: "not_found" });
  });

  it("fila: pendentes primeiro", async () => {
    const a = await makeMember();
    const b = await makeMember();
    await apply(a, "mentor");
    await apply(b, "mentor");
    await reviewApplication({ hackathonId: ED, applicationId: await idOf(a, "mentor"), action: "approve", reviewerId: null });
    const list = await listApplications(ED);
    expect(list.map((x) => [x.memberId, x.status])).toEqual([
      [b, "pending"],
      [a, "approved"],
    ]);
  });
});

describe("formulário por público", () => {
  it("cada público tem perguntas, ordem e contagem próprias; participante continua o default", async () => {
    const p1 = await createQuestion(ED, { kind: "short_text", label: "Curso" });
    const m1 = await createQuestion(ED, { kind: "short_text", label: "Área", audience: "mentor" });
    const m2 = await createQuestion(ED, { kind: "yes_no", label: "Já mentorou?", audience: "mentor" });
    expect((await listQuestions(ED)).map((q) => q.id)).toEqual([p1.id]);
    expect((await listQuestions(ED, { audience: "mentor" })).map((q) => q.id)).toEqual([m1.id, m2.id]);
    expect(await listQuestions(ED, { audience: "jurado" })).toEqual([]);
    expect(await hasActiveQuestions(ED, "jurado")).toBe(false);
    expect(await hasActiveQuestions(ED, "mentor")).toBe(true);
    expect(m1.audience).toBe("mentor");
    expect(m1.position).toBe(1);
    // mover dentro do público do mentor não mexe no do participante
    expect(await moveQuestion(ED, m2.id, "up")).toBe(true);
    expect((await listQuestions(ED, { audience: "mentor" })).map((q) => q.id)).toEqual([m2.id, m1.id]);
    expect((await listQuestions(ED)).map((q) => q.id)).toEqual([p1.id]);
  });

  it("resposta de candidatura congela a versão da pergunta", async () => {
    const q = await createQuestion(ED, { kind: "short_text", label: "Área", audience: "jurado" });
    const m = await makeMember();
    await apply(m, "jurado", { answers: { [q.id]: "dados" } });
    expect(await countCurrentAnswers(ED, "jurado")).toEqual({ [q.id]: 1 });
    const upd = await updateQuestion(ED, q.id, { label: "Área de atuação" });
    expect(upd!.version).toBe(2);
    const [view] = await listApplications(ED, "jurado");
    expect(view.answers[0]).toMatchObject({ label: "Área", questionVersion: 1 });
  });

  it("finalidade do consentimento muda por tipo", async () => {
    expect((await consentPurpose(ED)).text).toContain("desta inscrição");
    expect((await consentPurpose(ED, "voluntario")).text).toContain("candidatura a voluntário");
    expect((await consentPurpose(ED, "jurado")).text).toContain("candidatura a jurado");
  });
});
