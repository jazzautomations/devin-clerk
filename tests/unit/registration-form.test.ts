import { beforeEach, describe, expect, it } from "vitest";
import db from "@/lib/db";
import {
  TERMS_VERSION,
  consentPurpose,
  createQuestion,
  getAnswersForRegistration,
  listQuestions,
  listRegistrantsWithAnswers,
  moveQuestion,
  registrantsCsv,
  setQuestionArchived,
  submitRegistration,
  updateQuestion,
  validateAnswers,
  validateQuestionInput,
} from "@/lib/registrationForm";
import {
  getEditionCapacity,
  getRegistrationIds,
  getRegistrationStatus,
  getRegistrationsByHackathon,
  getWaitlistPosition,
  listPromotions,
  register,
  reviewRegistration,
  setEditionCapacity,
  unregister,
} from "@/lib/registrations";
import { getMemberCard } from "@/lib/xp";

// spec 033 US1 + FR-001/002/009 — formulário por edição, consentimento LGPD,
// vagas com fila de espera e promoção automática.

const ED = "form-ut";
const CURATED = "form-ut-curada";
let seq = 0;

async function makeMember(): Promise<number> {
  seq++;
  const clerk = `c_form_${seq}_${Date.now()}`;
  await db
    .prepare("INSERT INTO members (clerkId, username, email) VALUES (?, ?, ?)")
    .run(clerk, `uform${seq}_${Date.now() % 100000}`, `${clerk}@t.dev`);
  return (await db.prepare("SELECT id FROM members WHERE clerkId = ?").get<{ id: number }>(clerk))!.id;
}

const xpOf = async (id: number) =>
  (await db.prepare("SELECT xp FROM members WHERE id = ?").get<{ xp: number }>(id))!.xp;

beforeEach(async () => {
  for (const [id, approval] of [
    [ED, 0],
    [CURATED, 1],
  ] as const) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO hackathons
           (id, name, organizer, startsAt, format, registrationUrl, tags, requiresApproval)
         VALUES (?, 'Form UT', 'Hack Inova', '2099-03-01', 'presencial', 'https://x.dev', '[]', ?)`,
      )
      .run(id, approval);
  }
  await db.prepare("DELETE FROM registrations WHERE hackathonId IN (?, ?)").run(ED, CURATED);
  await db.prepare("DELETE FROM consents WHERE hackathonId IN (?, ?)").run(ED, CURATED);
  await db.prepare("DELETE FROM edition_questions WHERE hackathonId IN (?, ?)").run(ED, CURATED);
  await db.prepare("DELETE FROM member_cards WHERE hackathonId IN (?, ?)").run(ED, CURATED);
  await db.prepare("UPDATE hackathons SET capacity = NULL WHERE id IN (?, ?)").run(ED, CURATED);
});

describe("validateQuestionInput", () => {
  it("aceita os 5 tipos e exige opções em single/multi", () => {
    expect(validateQuestionInput({ kind: "short_text", label: "Curso" }).ok).toBe(true);
    expect(validateQuestionInput({ kind: "yes_no", label: "Já tem time?" }).ok).toBe(true);
    expect(validateQuestionInput({ kind: "single", label: "Camiseta", options: [] }).ok).toBe(false);
    expect(validateQuestionInput({ kind: "multi", label: "Stack", options: ["a", "b"] }).ok).toBe(true);
    expect(validateQuestionInput({ kind: "dropdown", label: "x" }).ok).toBe(false);
    expect(validateQuestionInput({ kind: "short_text", label: "  " }).ok).toBe(false);
  });

  it("opções duplicadas/vazias são limpas", () => {
    const r = validateQuestionInput({ kind: "single", label: "T", options: ["P", " P ", "", "M"] });
    expect(r.ok && r.value.options).toEqual(["P", "M"]);
  });
});

describe("perguntas da edição", () => {
  it("cria em ordem, reordena e arquiva (arquivada some do formulário)", async () => {
    const a = await createQuestion(ED, { kind: "short_text", label: "Curso", required: true });
    const b = await createQuestion(ED, { kind: "single", label: "Camiseta", options: ["P", "M", "G"] });
    const c = await createQuestion(ED, { kind: "yes_no", label: "Já tem time?" });
    expect((await listQuestions(ED)).map((q) => q.id)).toEqual([a.id, b.id, c.id]);

    await moveQuestion(ED, c.id, "up");
    expect((await listQuestions(ED)).map((q) => q.id)).toEqual([a.id, c.id, b.id]);
    await moveQuestion(ED, a.id, "up"); // já é o primeiro: no-op
    expect((await listQuestions(ED)).map((q) => q.id)).toEqual([a.id, c.id, b.id]);

    await setQuestionArchived(ED, c.id, true);
    expect((await listQuestions(ED)).map((q) => q.id)).toEqual([a.id, b.id]);
    expect((await listQuestions(ED, { includeArchived: true })).length).toBe(3);
  });

  it("pergunta de outra edição não é editável por essa", async () => {
    const q = await createQuestion(CURATED, { kind: "short_text", label: "X" });
    expect(await updateQuestion(ED, q.id, { label: "hack" })).toBeNull();
  });
});

describe("validateAnswers — obrigatória e tipos", () => {
  it("obrigatória vazia → erro apontando a pergunta", async () => {
    const req = await createQuestion(ED, { kind: "short_text", label: "Curso", required: true });
    await createQuestion(ED, { kind: "long_text", label: "Bio" });
    const qs = await listQuestions(ED);
    const r = validateAnswers(qs, { [req.id]: "   " });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.questionId).toBe(req.id);
  });

  it("single fora das opções, multi com intruso e yes_no inválido são recusados", async () => {
    const s = await createQuestion(ED, { kind: "single", label: "T", options: ["P", "M"] });
    const m = await createQuestion(ED, { kind: "multi", label: "S", options: ["js", "py"] });
    const y = await createQuestion(ED, { kind: "yes_no", label: "Y" });
    const qs = await listQuestions(ED);
    expect(validateAnswers(qs, { [s.id]: "GG" }).ok).toBe(false);
    expect(validateAnswers(qs, { [m.id]: ["js", "rust"] }).ok).toBe(false);
    expect(validateAnswers(qs, { [y.id]: "talvez" }).ok).toBe(false);
    const ok = validateAnswers(qs, { [s.id]: "M", [m.id]: ["py", "js"], [y.id]: true });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      const byId = new Map(ok.answers.map((a) => [a.questionId, a.value]));
      expect(byId.get(m.id)).toBe(JSON.stringify(["py", "js"]));
      expect(byId.get(y.id)).toBe("sim");
    }
  });

  it("opcional vazia não grava resposta; pergunta desconhecida é ignorada", async () => {
    const q = await createQuestion(ED, { kind: "short_text", label: "Apelido" });
    const r = validateAnswers(await listQuestions(ED), { [q.id]: "", 99999: "x" });
    expect(r.ok && r.answers).toEqual([]);
  });
});

describe("submitRegistration — consentimento + respostas numa transação", () => {
  it("sem consentimento → 400 e nada gravado", async () => {
    const m = await makeMember();
    const r = await submitRegistration({ memberId: m, hackathonId: ED, answers: {}, consent: false, ip: "1.2.3.4" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("consent_required");
    expect(await getRegistrationStatus(m, ED)).toBeNull();
  });

  it("obrigatória vazia → 400, sem inscrição, sem consentimento, sem resposta", async () => {
    const m = await makeMember();
    const req = await createQuestion(ED, { kind: "short_text", label: "Curso", required: true });
    const opt = await createQuestion(ED, { kind: "short_text", label: "Apelido" });
    const r = await submitRegistration({
      memberId: m,
      hackathonId: ED,
      answers: { [opt.id]: "zé" },
      consent: true,
      ip: "1.2.3.4",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.questionId).toBe(req.id);
    expect(await getRegistrationStatus(m, ED)).toBeNull();
    const consents = await db.prepare("SELECT COUNT(*) AS n FROM consents WHERE memberId = ?").get<{ n: number }>(m);
    expect(consents!.n).toBe(0);
    expect(await xpOf(m)).toBe(0);
  });

  it("válido → inscrição approved + respostas + consentimento com versão, finalidade e IP", async () => {
    const m = await makeMember();
    await db
      .prepare("INSERT OR IGNORE INTO challenges (id, hackathonId, sponsor, title) VALUES (?, ?, 'Banco Parceiro', 'Desafio')")
      .run("ch-form-ut", ED);
    const q = await createQuestion(ED, { kind: "short_text", label: "Curso", required: true });
    const r = await submitRegistration({ memberId: m, hackathonId: ED, answers: { [q.id]: "ADS" }, consent: true, ip: "200.1.1.1" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.status).toBe("approved");
      expect(r.created).toBe(true);
      expect(r.reward?.xp).toBe("+50");
    }
    const c = await db
      .prepare("SELECT termsVersion, purpose, ip, acceptedAt FROM consents WHERE memberId = ? AND hackathonId = ?")
      .get<{ termsVersion: string; purpose: string; ip: string; acceptedAt: string }>(m, ED);
    expect(c?.termsVersion).toBe(TERMS_VERSION);
    expect(c?.ip).toBe("200.1.1.1");
    expect(c?.acceptedAt).toMatch(/^\d{4}-\d{2}-\d{2} /);
    expect(c?.purpose).toContain("Hack Inova");
    expect(c?.purpose).toContain("Banco Parceiro");
    const purpose = await consentPurpose(ED);
    expect(c?.purpose).toBe(purpose.text);
    const answers = await getAnswersForRegistration(m, ED);
    expect(answers).toEqual([expect.objectContaining({ questionId: q.id, label: "Curso", value: "ADS" })]);
  });

  it("edição sem perguntas: só o consentimento basta (1 clique + caixa)", async () => {
    const m = await makeMember();
    const r = await submitRegistration({ memberId: m, hackathonId: ED, answers: undefined, consent: true, ip: null });
    expect(r.ok && r.status).toBe("approved");
  });

  it("re-envio de quem já está inscrito é idempotente (não paga de novo nem exige caixa)", async () => {
    const m = await makeMember();
    await submitRegistration({ memberId: m, hackathonId: ED, answers: {}, consent: true, ip: null });
    const xp = await xpOf(m);
    const again = await submitRegistration({ memberId: m, hackathonId: ED, answers: {}, consent: false, ip: null });
    expect(again.ok && again.created).toBe(false);
    expect(await xpOf(m)).toBe(xp);
  });

  it("falha no meio da transação desfaz tudo (resposta apontando versão inexistente)", async () => {
    const m = await makeMember();
    const q = await createQuestion(ED, { kind: "short_text", label: "Curso" });
    // corrompe a versão viva pra o INSERT da resposta violar a FK
    await db.prepare("UPDATE edition_questions SET version = 99 WHERE id = ?").run(q.id);
    await expect(
      submitRegistration({ memberId: m, hackathonId: ED, answers: { [q.id]: "x" }, consent: true, ip: null }),
    ).rejects.toThrow();
    expect(await getRegistrationStatus(m, ED)).toBeNull();
    const n = await db.prepare("SELECT COUNT(*) AS n FROM consents WHERE memberId = ?").get<{ n: number }>(m);
    expect(n!.n).toBe(0);
  });
});

describe("versão congelada", () => {
  it("editar pergunta SEM resposta edita no lugar (version fica 1)", async () => {
    const q = await createQuestion(ED, { kind: "short_text", label: "Curso" });
    const u = await updateQuestion(ED, q.id, { label: "Curso de graduação" });
    expect(u?.version).toBe(1);
    expect(u?.label).toBe("Curso de graduação");
  });

  it("editar pergunta COM resposta sobe a version; resposta antiga segue com o texto original", async () => {
    const q = await createQuestion(ED, { kind: "single", label: "Camiseta", options: ["P", "M"] });
    const m1 = await makeMember();
    await submitRegistration({ memberId: m1, hackathonId: ED, answers: { [q.id]: "M" }, consent: true, ip: null });

    const u = await updateQuestion(ED, q.id, { label: "Tamanho da camiseta", options: ["P", "M", "G"] });
    expect(u?.version).toBe(2);

    const m2 = await makeMember();
    await submitRegistration({ memberId: m2, hackathonId: ED, answers: { [q.id]: "G" }, consent: true, ip: null });

    const a1 = await getAnswersForRegistration(m1, ED);
    const a2 = await getAnswersForRegistration(m2, ED);
    expect(a1[0]).toMatchObject({ label: "Camiseta", questionVersion: 1, value: "M" });
    expect(a2[0]).toMatchObject({ label: "Tamanho da camiseta", questionVersion: 2, value: "G" });
  });

  it("mudar só obrigatoriedade/posição não cria versão nova", async () => {
    const q = await createQuestion(ED, { kind: "short_text", label: "Curso" });
    const m = await makeMember();
    await submitRegistration({ memberId: m, hackathonId: ED, answers: { [q.id]: "x" }, consent: true, ip: null });
    const u = await updateQuestion(ED, q.id, { required: true });
    expect(u?.version).toBe(1);
    expect(u?.required).toBe(true);
  });
});

describe("vagas + fila de espera", () => {
  it("capacidade cheia → nova inscrição entra como waitlist com posição, sem carta/XP", async () => {
    await setEditionCapacity(ED, 1);
    const a = await makeMember();
    const b = await makeMember();
    const c = await makeMember();
    expect((await register(a, ED)).status).toBe("approved");
    const rb = await submitRegistration({ memberId: b, hackathonId: ED, answers: {}, consent: true, ip: null });
    expect(rb.ok && rb.status).toBe("waitlist");
    expect(rb.ok && rb.position).toBe(1);
    expect(rb.ok && rb.reward).toBeUndefined();
    await submitRegistration({ memberId: c, hackathonId: ED, answers: {}, consent: true, ip: null });
    expect(await getWaitlistPosition(c, ED)).toBe(2);
    expect(await xpOf(b)).toBe(0);
    expect(await getMemberCard(b, ED)).toBeNull();
    // waitlist não conta como inscrito em gate nem na lista pública
    expect(await getRegistrationIds(b)).not.toContain(ED);
    expect((await getRegistrationsByHackathon(ED)).length).toBe(1);
    expect(await getEditionCapacity(ED)).toMatchObject({ capacity: 1, approved: 1, waitlist: 2, remaining: 0 });
  });

  it("cancelamento de aprovado promove o 1º da fila (com recompensa) e registra promotedAt", async () => {
    await setEditionCapacity(ED, 1);
    const a = await makeMember();
    const b = await makeMember();
    const c = await makeMember();
    await register(a, ED);
    await register(b, ED);
    await register(c, ED);
    const { promoted } = await unregister(a, ED);
    expect(promoted.map((p) => p.memberId)).toEqual([b]);
    expect(await getRegistrationStatus(b, ED)).toBe("approved");
    expect(await getRegistrationStatus(c, ED)).toBe("waitlist");
    expect(await getWaitlistPosition(c, ED)).toBe(1);
    expect(await xpOf(b)).toBe(50);
    expect(await getMemberCard(b, ED)).not.toBeNull();
    const hook = await listPromotions(ED);
    expect(hook).toEqual([expect.objectContaining({ memberId: b, promotedAt: expect.any(String) })]);
    const notif = await db
      .prepare("SELECT COUNT(*) AS n FROM notifications WHERE memberId = ? AND type = 'waitlist_promoted'")
      .get<{ n: number }>(b);
    expect(notif!.n).toBe(1);
  });

  it("cancelar quem está na fila não promove ninguém", async () => {
    await setEditionCapacity(ED, 1);
    const a = await makeMember();
    const b = await makeMember();
    await register(a, ED);
    await register(b, ED);
    const { promoted } = await unregister(b, ED);
    expect(promoted).toEqual([]);
    expect(await getRegistrationStatus(a, ED)).toBe("approved");
  });

  it("aumentar a capacidade promove a fila até encher", async () => {
    await setEditionCapacity(ED, 1);
    const ids = [await makeMember(), await makeMember(), await makeMember(), await makeMember()];
    for (const id of ids) await register(id, ED);
    const { promoted } = await setEditionCapacity(ED, 3);
    expect(promoted.map((p) => p.memberId)).toEqual([ids[1], ids[2]]);
    expect(await getRegistrationStatus(ids[3], ED)).toBe("waitlist");
    const { promoted: all } = await setEditionCapacity(ED, null);
    expect(all.map((p) => p.memberId)).toEqual([ids[3]]);
  });

  it("inscrições simultâneas não estouram a capacidade (lock na edição)", async () => {
    await setEditionCapacity(ED, 2);
    const ids = await Promise.all([1, 2, 3, 4, 5].map(() => makeMember()));
    const res = await Promise.all(ids.map((id) => register(id, ED)));
    expect(res.filter((r) => r.status === "approved").length).toBe(2);
    expect(res.filter((r) => r.status === "waitlist").length).toBe(3);
  });

  it("edição curada: aprovar com a edição cheia manda pra fila; cancelamento promove", async () => {
    await setEditionCapacity(CURATED, 1);
    const a = await makeMember();
    const b = await makeMember();
    await register(a, CURATED);
    await register(b, CURATED);
    expect((await reviewRegistration(a, CURATED, "approve"))?.status).toBe("approved");
    const rb = await reviewRegistration(b, CURATED, "approve");
    expect(rb?.status).toBe("waitlist");
    expect(await xpOf(b)).toBe(0);
    await unregister(a, CURATED);
    expect(await getRegistrationStatus(b, CURATED)).toBe("approved");
    expect(await xpOf(b)).toBe(50);
  });

  it("revogar (reject) um aprovado libera a vaga pra fila", async () => {
    await setEditionCapacity(ED, 1);
    const a = await makeMember();
    const b = await makeMember();
    await register(a, ED);
    await register(b, ED);
    await reviewRegistration(a, ED, "reject");
    expect(await getRegistrationStatus(b, ED)).toBe("approved");
  });
});

describe("admin: inscritos com respostas + CSV", () => {
  it("lista com respostas e CSV com uma coluna por pergunta (escape e anti-fórmula)", async () => {
    const q1 = await createQuestion(ED, { kind: "short_text", label: "Curso", required: true });
    const q2 = await createQuestion(ED, { kind: "multi", label: "Stack, preferida", options: ["js", "py"] });
    const m = await makeMember();
    await submitRegistration({
      memberId: m,
      hackathonId: ED,
      answers: { [q1.id]: '=HYPERLINK("x")', [q2.id]: ["js", "py"] },
      consent: true,
      ip: null,
    });
    const rows = await listRegistrantsWithAnswers(ED);
    expect(rows).toHaveLength(1);
    expect(rows[0].answers[q1.id]?.value).toBe('=HYPERLINK("x")');
    expect(rows[0].consentVersion).toBe(TERMS_VERSION);

    const questions = await listQuestions(ED, { includeArchived: true });
    const csv = registrantsCsv(questions, rows);
    const [header, line] = csv.trim().split("\n");
    expect(header).toContain("Curso");
    expect(header).toContain('"Stack, preferida"');
    expect(line).toContain(`"'=HYPERLINK(""x"")"`);
    expect(line).toContain("js; py");
  });
});
