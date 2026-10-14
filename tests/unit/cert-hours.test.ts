import { beforeEach, describe, expect, it } from "vitest";
import db from "@/lib/db";
import { createTeam } from "@/lib/archive";
import { grantEditionRole } from "@/lib/roles";
import { addCriterion, assignAll, publishResults, saveScores } from "@/lib/jury";
import {
  attendeesForCertificates,
  buildHoursCsv,
  CertificateError,
  rolesMissingHours,
  getCertificate,
  hoursCsvRows,
  issueCertificates,
  listMemberCertificates,
  type HoursCsvRow,
} from "@/lib/certificates";
import { certificatePdf } from "@/lib/certificatePdf";
import {
  CertSettingsError,
  defaultEditionHours,
  getCertSettings,
  hoursFor,
  resolveQuestionMapping,
  updateCertSettings,
} from "@/lib/certHours";

// certificado com carga horária — roadmap 037 #2 (research 035 #3)

const H = "hack-inova-alphaville-2026";
// seed: 2026-11-14 09:00 → 2026-11-15 18:00 (BRT) = 33 h corridas
const H_DEFAULT = 33;

async function memberId(username: string, name: string | null = null): Promise<number> {
  await db
    .prepare("INSERT OR IGNORE INTO members (clerkId, username, email, name) VALUES (?, ?, ?, ?)")
    .run(`clerk_${username}`, username, `${username}@t.dev`, name);
  return (await db.prepare("SELECT id FROM members WHERE username = ?").get<{ id: number }>(username))!.id;
}

async function register(id: number, checkedIn = true) {
  await db
    .prepare("INSERT OR IGNORE INTO registrations (memberId, hackathonId, status) VALUES (?, ?, 'approved')")
    .run(id, H);
  if (checkedIn) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO checkins (registrationId)
         SELECT id FROM registrations WHERE memberId = ? AND hackathonId = ?`,
      )
      .run(id, H);
  }
}

async function question(label: string): Promise<number> {
  const q = await db
    .prepare(
      `INSERT INTO edition_questions (hackathonId, kind, label, position) VALUES (?, 'short_text', ?, 0) RETURNING id`,
    )
    .get<{ id: number }>(H, label);
  await db
    .prepare("INSERT INTO edition_question_versions (questionId, version, kind, label) VALUES (?, 1, 'short_text', ?)")
    .run(q!.id, label);
  return q!.id;
}

async function answer(memberId: number, questionId: number, value: string) {
  await db
    .prepare(
      `INSERT INTO registration_answers (registrationId, questionId, questionVersion, value)
       SELECT id, ?, 1, ? FROM registrations WHERE memberId = ? AND hackathonId = ?`,
    )
    .run(questionId, value, memberId, H);
}

beforeEach(async () => {
  for (const t of [
    "checkins",
    "certificates",
    "certificate_settings",
    "registration_answers",
    "scores",
    "judge_assignments",
    "rubric_criteria",
    "jury_results",
    "edition_roles",
  ]) {
    await db.exec(`DELETE FROM ${t}`);
  }
  await db.exec(`DELETE FROM edition_questions WHERE hackathonId = '${H}'`);
  await db.exec(`DELETE FROM registrations WHERE hackathonId = '${H}'`);
  await db.exec(`DELETE FROM project_submissions WHERE teamId IN (SELECT id FROM teams WHERE hackathonId = '${H}')`);
  await db.exec(`DELETE FROM team_members WHERE teamId IN (SELECT id FROM teams WHERE hackathonId = '${H}')`);
  await db.exec(`DELETE FROM team_projects WHERE teamId IN (SELECT id FROM teams WHERE hackathonId = '${H}')`);
  await db.exec(`DELETE FROM teams WHERE hackathonId = '${H}'`);
  await db.exec(`UPDATE hackathons SET submissionDeadline = NULL WHERE id = '${H}'`);
});

describe("horas default pela duração da edição", () => {
  it("com horário: horas corridas arredondadas", () => {
    expect(defaultEditionHours("2026-11-14T09:00:00-03:00", "2026-11-15T18:00:00-03:00")).toBe(33);
    expect(defaultEditionHours("2026-10-10 12:00:00", "2026-10-10 20:20:00")).toBe(8);
    expect(defaultEditionHours("2026-10-10 12:00:00", "2026-10-10 12:10:00")).toBe(1);
  });

  it("só data: 8 h por dia de evento, inclusivo", () => {
    expect(defaultEditionHours("2026-10-10", "2026-10-12")).toBe(24);
    expect(defaultEditionHours("2026-10-10", "2026-10-10")).toBe(8);
  });

  it("sem fim, fim antes do início ou data ruim: um dia (8 h)", () => {
    expect(defaultEditionHours("2026-10-10", null)).toBe(8);
    expect(defaultEditionHours("2026-10-12", "2026-10-10")).toBe(8);
    expect(defaultEditionHours("lixo", "2026-10-10")).toBe(8);
  });

  it("override por papel vence o default; só o participante herda a duração (auditoria 041)", () => {
    const h = { startsAt: "2026-10-10", endsAt: "2026-10-11" };
    const s = { hours: { participante: null, staff: null, mentor: 6, jurado: null, organizador: null } };
    expect(hoursFor(s, h, "participante")).toBe(16);
    expect(hoursFor({ hours: { ...s.hours, participante: 20 } }, h, "participante")).toBe(20);
    expect(hoursFor(s, h, "mentor")).toBe(6);
    expect(hoursFor(s, h, "jurado")).toBeNull();
    expect(hoursFor(s, h, "staff")).toBeNull();
    expect(hoursFor(s, h, "organizador")).toBeNull();
  });
});

describe("configuração", () => {
  it("valida horas inteiras de 1 a 1000 e guarda o resto", async () => {
    await expect(updateCertSettings(H, { hours: { participante: 0 } })).rejects.toBeInstanceOf(CertSettingsError);
    await expect(updateCertSettings(H, { hours: { mentor: 2.5 } })).rejects.toBeInstanceOf(CertSettingsError);
    await expect(updateCertSettings(H, { hours: { jurado: 1001 } })).rejects.toBeInstanceOf(CertSettingsError);
    await updateCertSettings(H, { hours: { participante: 40, mentor: "" }, institution: "  FIAP  ", requireLockedEntry: true });
    const s = await getCertSettings(H);
    expect(s.hours).toEqual({ participante: 40, staff: null, mentor: null, jurado: null, organizador: null });
    expect(s.institution).toBe("FIAP");
    expect(s.requireLockedEntry).toBe(true);
    // patch parcial não apaga o que não veio
    await updateCertSettings(H, { hours: { staff: 10 } });
    expect((await getCertSettings(H)).hours).toMatchObject({ participante: 40, staff: 10 });
  });

  it("pergunta de outra edição não serve de curso", async () => {
    await expect(updateCertSettings(H, { courseQuestionId: 999999 })).rejects.toBeInstanceOf(CertSettingsError);
  });
});

describe("emissão com carga horária", () => {
  it("participante sai com as horas default, papel, período e instituição do organizador", async () => {
    const a = await memberId("ch_part", "Ana Horas");
    await register(a);
    await issueCertificates(H);
    const [c] = await listMemberCertificates(a);
    expect(c).toMatchObject({ kind: "participacao", role: "participante", hours: H_DEFAULT });
    expect(c.periodStart).toBe("2026-11-14T09:00:00-03:00");
    expect(c.periodEnd).toBe("2026-11-15T18:00:00-03:00");
    expect(c.institution).toBeTruthy();
  });

  it("horas por papel: staff, mentor, jurado e organizador com override; premiação sem horas", async () => {
    await updateCertSettings(H, {
      hours: { participante: 30, staff: 12, mentor: 6, jurado: 4, organizador: 50 },
      institution: "Hack Inova + FIAP",
    });
    const staff = await memberId("ch_staff");
    const mentor = await memberId("ch_mentor");
    const jur = await memberId("ch_jur");
    const org = await memberId("ch_org");
    const orgStaff = await memberId("ch_orgstaff");
    const campea = await memberId("ch_campea");
    await grantEditionRole(H, staff, "staff", null);
    await grantEditionRole(H, mentor, "mentor", null);
    await grantEditionRole(H, jur, "jurado", null);
    await grantEditionRole(H, org, "organizador", null);
    await grantEditionRole(H, orgStaff, "organizador", null);
    await grantEditionRole(H, orgStaff, "staff", null);
    await register(campea);
    const t = (await createTeam(H, { name: "Horas FC", placement: 0, memberUsernames: ["ch_campea"] })).team.id;
    const c = await addCriterion(H, { label: "Impacto", weight: 1 });
    await assignAll(H);
    await saveScores(H, jur, t, [{ criterionId: c.id, score: 5 }], null);
    await publishResults(H, org);
    await issueCertificates(H);

    const one = async (id: number, kind: string) =>
      (await listMemberCertificates(id)).find((x) => x.kind === kind)!;
    expect(await one(staff, "organizacao")).toMatchObject({ role: "staff", hours: 12 });
    expect(await one(mentor, "mentoria")).toMatchObject({ role: "mentor", hours: 6 });
    expect(await one(jur, "jurado")).toMatchObject({ role: "jurado", hours: 4 });
    expect(await one(org, "organizacao")).toMatchObject({ role: "organizador", hours: 50 });
    // organizador + staff: um certificado, horas do papel mais alto
    expect(await one(orgStaff, "organizacao")).toMatchObject({ role: "organizador", hours: 50 });
    expect(await one(campea, "participacao")).toMatchObject({ role: "participante", hours: 30 });
    expect(await one(campea, "premiacao")).toMatchObject({ hours: null });
    expect((await one(campea, "participacao")).institution).toBe("Hack Inova + FIAP");
  });

  it("auditoria 041: papel sem horas preenchidas bloqueia a emissão (409) e diz qual falta", async () => {
    const part = await memberId("ch_semhora_part");
    const jur = await memberId("ch_semhora_jur");
    const mentor = await memberId("ch_semhora_mentor");
    await register(part);
    await grantEditionRole(H, jur, "jurado", null);
    await grantEditionRole(H, mentor, "mentor", null);
    const err = await issueCertificates(H).catch((e) => e);
    expect(err).toBeInstanceOf(CertificateError);
    expect(err.status).toBe(409);
    expect(err.message).toMatch(/mentor\(a\) e jurado\(a\)/);
    expect(await listMemberCertificates(part)).toEqual([]); // nada sai pela metade
    expect(await rolesMissingHours(H, await getCertSettings(H))).toEqual(["mentor", "jurado"]);

    await updateCertSettings(H, { hours: { jurado: 3, mentor: 8 } });
    expect(await rolesMissingHours(H, await getCertSettings(H))).toEqual([]);
    const r = await issueCertificates(H);
    expect(r.created).toBe(3);
    expect((await listMemberCertificates(part))[0]).toMatchObject({ hours: H_DEFAULT });
    expect((await listMemberCertificates(jur))[0]).toMatchObject({ hours: 3 });
  });

  it("congela: mudar horas/instituição depois não muda certificado já emitido; quem chega depois pega o novo", async () => {
    const a = await memberId("ch_frozen");
    await register(a);
    await updateCertSettings(H, { hours: { participante: 20 }, institution: "Antes" });
    await issueCertificates(H);
    const [before] = await listMemberCertificates(a);
    expect(before).toMatchObject({ hours: 20, institution: "Antes" });

    await updateCertSettings(H, { hours: { participante: 99 }, institution: "Depois" });
    await db.exec(`UPDATE hackathons SET endsAt = '2026-11-20T18:00:00-03:00' WHERE id = '${H}'`);
    try {
      const b = await memberId("ch_late");
      await register(b);
      await issueCertificates(H);
      const [after] = await listMemberCertificates(a);
      expect(after).toMatchObject({ code: before.code, hours: 20, institution: "Antes", periodEnd: before.periodEnd });
      const [late] = await listMemberCertificates(b);
      expect(late).toMatchObject({ hours: 99, institution: "Depois" });
    } finally {
      await db.exec(`UPDATE hackathons SET endsAt = '2026-11-15T18:00:00-03:00' WHERE id = '${H}'`);
    }
  });

  it("certificado antigo (sem horas congeladas) segue válido e sem horas", async () => {
    const a = await memberId("ch_legacy", "Lia Legado");
    await db
      .prepare(
        `INSERT INTO certificates (code, memberId, hackathonId, kind, issuedAt)
         VALUES ('ANT1G00001', ?, ?, 'participacao', '2026-01-01 10:00:00')`,
      )
      .run(a, H);
    const c = await getCertificate("ANT1G00001");
    expect(c).toMatchObject({ hours: null, role: null, periodStart: null });
    expect(c!.institution).toBeTruthy();
    const bytes = await certificatePdf(c!, "https://hackahub.test");
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe("%PDF-");
  });
});

describe("presença mínima", () => {
  it("check-in é obrigatório sempre", async () => {
    const faltou = await memberId("ch_faltou");
    await register(faltou, false);
    expect(await attendeesForCertificates(H)).toEqual([]);
  });

  it("exigindo entrega: edição sem prazo pede projeto cadastrado do time", async () => {
    const com = await memberId("ch_com_projeto");
    const sem = await memberId("ch_sem_projeto");
    const solo = await memberId("ch_sem_time");
    for (const m of [com, sem, solo]) await register(m);
    await createTeam(H, { name: "Com Projeto", placement: 0, memberUsernames: ["ch_com_projeto"], project: { title: "X" } });
    await createTeam(H, { name: "Sem Projeto", placement: 0, memberUsernames: ["ch_sem_projeto"] });
    expect(await attendeesForCertificates(H)).toHaveLength(3);
    await updateCertSettings(H, { requireLockedEntry: true });
    expect(await attendeesForCertificates(H)).toEqual([com]);
  });

  it("exigindo entrega: edição com prazo pede versão enviada (rascunho não conta)", async () => {
    await db.exec(`UPDATE hackathons SET submissionDeadline = '2026-11-15 17:00:00' WHERE id = '${H}'`);
    const enviou = await memberId("ch_enviou");
    const rascunho = await memberId("ch_rascunho");
    await register(enviou);
    await register(rascunho);
    const t1 = (await createTeam(H, { name: "Enviou", placement: 0, memberUsernames: ["ch_enviou"], project: { title: "A" } })).team.id;
    await createTeam(H, { name: "Rascunho", placement: 0, memberUsernames: ["ch_rascunho"], project: { title: "B" } });
    await db.prepare("INSERT INTO project_submissions (teamId, version, snapshot) VALUES (?, 1, '{}')").run(t1);
    await updateCertSettings(H, { requireLockedEntry: true });
    expect(await attendeesForCertificates(H)).toEqual([enviou]);
    await issueCertificates(H);
    expect(await listMemberCertificates(rascunho)).toEqual([]);
  });
});

describe("CSV de hora complementar", () => {
  it("acha curso/instituição/matrícula pelo texto da pergunta; o apontado vence; sem repetir pergunta", () => {
    const qs = [
      { id: 1, label: "Qual teu nome social?", archived: false },
      { id: 2, label: "Instituição de ensino", archived: false },
      { id: 3, label: "Curso", archived: false },
      { id: 4, label: "RA (matrícula)", archived: false },
      { id: 5, label: "Curso antigo", archived: true },
    ];
    expect(resolveQuestionMapping(qs, { courseQuestionId: null, institutionQuestionId: null, enrollmentQuestionId: null })).toEqual({
      course: 3,
      institution: 2,
      enrollment: 4,
    });
    expect(resolveQuestionMapping(qs, { courseQuestionId: 5, institutionQuestionId: null, enrollmentQuestionId: null }).course).toBe(5);
    expect(resolveQuestionMapping([{ id: 9, label: "Telefone", archived: false }], {
      courseQuestionId: null,
      institutionQuestionId: null,
      enrollmentQuestionId: null,
    })).toEqual({ course: null, institution: null, enrollment: null });
  });

  it("ordena por instituição → curso → nome, sem resposta no fim, e neutraliza fórmula", () => {
    const base: Omit<HoursCsvRow, "memberName" | "institutionStudent" | "course" | "code"> = {
      username: "u",
      email: "u@t.dev",
      enrollment: "",
      role: "participante",
      kind: "participacao",
      hours: 33,
      periodStart: "2026-11-14",
      periodEnd: "2026-11-15",
      institution: "Hack Inova",
    };
    const csv = buildHoursCsv(
      [
        { ...base, memberName: "Zé", institutionStudent: "USP", course: "Direito", code: "C1" },
        { ...base, memberName: "Sem Resposta", institutionStudent: "", course: "", code: "C2" },
        { ...base, memberName: "Ana", institutionStudent: "FIAP", course: "SI", code: "C3" },
        { ...base, memberName: "=HYPERLINK(1)", institutionStudent: "USP", course: "Computação", code: "C4" },
      ],
      "https://hackahub.test",
    );
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe(
      "instituicao_aluno,curso,matricula,nome,email,username,papel,tipo,carga_horaria,periodo_inicio,periodo_fim,instituicao_promotora,codigo,verificacao",
    );
    expect(lines.slice(1).map((l) => l.split(",")[0] + "/" + l.split(",")[1])).toEqual([
      "FIAP/SI",
      "USP/Computação",
      "USP/Direito",
      "/",
    ]);
    expect(lines[2]).toContain("'=HYPERLINK(1)");
    expect(lines[1]).toContain(",33,2026-11-14,2026-11-15,Hack Inova,C3,https://hackahub.test/c/C3");
  });

  it("linhas reais: respostas do formulário mapeadas, horas congeladas e período em dia de Brasília", async () => {
    const qInst = await question("Faculdade");
    const qCurso = await question("Qual teu curso?");
    const a = await memberId("ch_csv_a", "Bruna CSV");
    const b = await memberId("ch_csv_b", "Caio CSV");
    await register(a);
    await register(b);
    await answer(a, qInst, "Mackenzie");
    await answer(a, qCurso, "Engenharia");
    const mentor = await memberId("ch_csv_mentor", "Mel Mentora");
    await grantEditionRole(H, mentor, "mentor", null);
    await updateCertSettings(H, { hours: { mentor: 6 } });
    await issueCertificates(H);
    const rows = await hoursCsvRows(H);
    expect(rows).toHaveLength(3);
    const bruna = rows.find((r) => r.memberName === "Bruna CSV")!;
    expect(bruna).toMatchObject({
      institutionStudent: "Mackenzie",
      course: "Engenharia",
      hours: H_DEFAULT,
      periodStart: "2026-11-14",
      periodEnd: "2026-11-15",
      role: "participante",
      email: "ch_csv_a@t.dev",
    });
    expect(rows.find((r) => r.memberName === "Caio CSV")).toMatchObject({ course: "", institutionStudent: "" });
    expect(rows.find((r) => r.memberName === "Mel Mentora")).toMatchObject({ hours: 6, role: "mentor(a)" });
  });
});
