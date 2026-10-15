import { beforeEach, describe, expect, it } from "vitest";
import db from "@/lib/db";
import {
  DEFAULT_CONDUCT,
  ageOn,
  getEditionTerms,
  getImageConsent,
  getImageConsentHistory,
  imageGrantedMembers,
  listMyImageConsents,
  mealReport,
  mealsCsv,
  parseBirthDate,
  saveEditionTerms,
  setImageConsent,
  termsSummaries,
  validateRegistrationTerms,
  validateTermsPatch,
} from "@/lib/eventTerms";
import { listRegistrantsWithAnswers, submitRegistration } from "@/lib/registrationForm";
import { getRegistrationStatus, unregister } from "@/lib/registrations";
import { deleteMemberData, exportMemberData } from "@/lib/privacy";
import {
  canHandleIncidents,
  createIncident,
  listIncidents,
  setConductHandler,
  updateIncident,
  validateIncident,
} from "@/lib/incidents";
import { grantEditionRole } from "@/lib/roles";
import { listBadges } from "@/lib/crachas";

// frente L — termos do evento: idade mínima/ECA, responsável, uso de imagem,
// código de conduta versionado, dieta e incidentes.

const ED = "terms-ut";
const PAST = "terms-ut-passada";
let seq = 0;

async function makeMember(email?: string): Promise<number> {
  seq++;
  const clerk = `c_terms_${seq}_${Date.now()}`;
  const row = await db
    .prepare("INSERT INTO members (clerkId, username, email, name) VALUES (?, ?, ?, ?) RETURNING id")
    .get<{ id: number }>(clerk, `uterms${seq}_${Date.now() % 100000}`, email ?? `${clerk}@t.dev`, `Pessoa ${seq}`);
  return row!.id;
}

const ADULT = { birthDate: "2000-01-01", conduct: true };
// edição daqui a 30 dias: dá pra ter menor com data de nascimento no passado
const START = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
const yearsBefore = (n: number) => `${Number(START.slice(0, 4)) - n}${START.slice(4)}`;
const ADULT_AGE_AT_START = Number(START.slice(0, 4)) - 2000 - (START.slice(5) < "01-01" ? 1 : 0);

beforeEach(async () => {
  for (const [id, starts] of [
    [ED, START],
    [PAST, "2020-06-10"],
  ] as const) {
    await db
      .prepare(
        `INSERT OR IGNORE INTO hackathons (id, name, organizer, startsAt, format, registrationUrl, tags, source)
         VALUES (?, 'Terms UT', 'Hack Inova', ?, 'presencial', 'https://x.dev', '[]', 'painel')`,
      )
      .run(id, starts);
  }
  await db.prepare("DELETE FROM registrations WHERE hackathonId IN (?, ?)").run(ED, PAST);
  await db.prepare("DELETE FROM edition_terms WHERE hackathonId = ?").run(ED);
  await db.prepare("DELETE FROM incidents WHERE hackathonId = ?").run(ED);
  await db.prepare("DELETE FROM image_consents WHERE hackathonId = ?").run(ED);
});

describe("idade", () => {
  it("ageOn conta anos completos na data do evento", () => {
    expect(ageOn("2008-06-10", "2026-06-10")).toBe(18);
    expect(ageOn("2008-06-11", "2026-06-10")).toBe(17);
    expect(ageOn("2008-07-01", "2026-06-10")).toBe(17);
  });

  it("parseBirthDate recusa data inexistente, futura ou fora do formato", () => {
    expect(parseBirthDate("2000-02-30")).toBeNull();
    expect(parseBirthDate("01/02/2000")).toBeNull();
    expect(parseBirthDate("2999-01-01")).toBeNull();
    expect(parseBirthDate("1800-01-01")).toBeNull();
    expect(parseBirthDate("2000-02-29")).toBe("2000-02-29");
  });
});

describe("validateRegistrationTerms", () => {
  const terms = { hackathonId: ED, minAge: 18, dietEnabled: false, conductVersion: 1, conductText: "x", allowsMinors: false };
  const ctx = { terms, startsAt: "2026-06-10", today: new Date("2026-01-01") };

  it("sem nascimento → birth_date_required", () => {
    expect(validateRegistrationTerms({ conduct: true }, ctx)).toMatchObject({ ok: false, error: "birth_date_required" });
  });

  it("abaixo da idade mínima → bloqueia com mensagem clara", () => {
    const r = validateRegistrationTerms({ birthDate: "2009-01-01", conduct: true }, ctx);
    expect(r).toMatchObject({ ok: false, error: "under_min_age:18" });
    if (!r.ok) expect(r.message).toMatch(/18 anos ou mais/);
  });

  it("edição 16+: menor sem responsável falha; com responsável e aceite passa", () => {
    const t16 = { ...ctx, terms: { ...terms, minAge: 16, allowsMinors: true }, memberEmail: "teen@t.dev" };
    const base = { birthDate: "2009-01-01", conduct: true };
    expect(validateRegistrationTerms(base, t16)).toMatchObject({ ok: false, error: "guardian_required" });
    expect(
      validateRegistrationTerms({ ...base, guardian: { name: "Maria Silva", email: "x" , accepted: true } }, t16),
    ).toMatchObject({ ok: false, error: "guardian_email_invalid" });
    expect(
      validateRegistrationTerms({ ...base, guardian: { name: "Maria Silva", email: "TEEN@t.dev", accepted: true } }, t16),
    ).toMatchObject({ ok: false, error: "guardian_email_same" });
    expect(
      validateRegistrationTerms({ ...base, guardian: { name: "Maria Silva", email: "mae@t.dev" } }, t16),
    ).toMatchObject({ ok: false, error: "guardian_consent_required" });
    const ok = validateRegistrationTerms(
      { ...base, guardian: { name: "Maria Silva", email: "mae@t.dev", accepted: true } },
      t16,
    );
    expect(ok).toMatchObject({ ok: true, value: { minor: true, ageAtEvent: 17, guardian: { email: "mae@t.dev" } } });
    // 15 anos numa edição 16+ continua bloqueado
    expect(validateRegistrationTerms({ birthDate: "2011-01-01", conduct: true }, t16)).toMatchObject({
      ok: false,
      error: "under_min_age:16",
    });
  });

  it("código de conduta é obrigatório; versão diferente da vigente avisa", () => {
    expect(validateRegistrationTerms({ birthDate: "2000-01-01" }, ctx)).toMatchObject({ ok: false, error: "conduct_required" });
    expect(validateRegistrationTerms({ ...ADULT, conductVersion: 2 }, ctx)).toMatchObject({
      ok: false,
      error: "conduct_outdated",
    });
  });

  it("uso de imagem só vale com true explícito; dieta ignorada quando desligada", () => {
    const r = validateRegistrationTerms({ ...ADULT, imageUse: "on", diet: ["vegano"] }, ctx);
    expect(r).toMatchObject({ ok: true, value: { imageUse: false, diet: [] } });
  });

  it("dieta ligada: valida opções e guarda alergia grave", () => {
    const c = { ...ctx, terms: { ...terms, dietEnabled: true } };
    expect(validateRegistrationTerms({ ...ADULT, diet: ["carnívoro"] }, c)).toMatchObject({ ok: false, error: "diet_invalid" });
    expect(
      validateRegistrationTerms({ ...ADULT, diet: ["vegano", "vegano"], allergies: " amendoim ", allergySevere: true }, c),
    ).toMatchObject({ ok: true, value: { diet: ["vegano"], allergies: "amendoim", allergySevere: true } });
  });
});

describe("configuração da edição", () => {
  it("padrão: 18+, sem dieta, código padrão v1", async () => {
    const t = await getEditionTerms(ED);
    expect(t).toMatchObject({ minAge: 18, dietEnabled: false, conductVersion: 1, allowsMinors: false });
    expect(t.conductText).toBe(DEFAULT_CONDUCT);
  });

  it("validateTermsPatch barra idade fora do intervalo e texto curto", () => {
    expect(validateTermsPatch({ minAge: 10 })).toMatchObject({ ok: false });
    expect(validateTermsPatch({ conductText: "curto" })).toMatchObject({ ok: false });
    expect(validateTermsPatch({})).toMatchObject({ ok: false });
    expect(validateTermsPatch({ minAge: 16, dietEnabled: true })).toMatchObject({ ok: true });
  });

  it("editar o código sobe a versão e congela a anterior", async () => {
    const ed = `${ED}-v`;
    await db
      .prepare(
        `INSERT OR IGNORE INTO hackathons (id, name, organizer, startsAt, format, registrationUrl, tags, source)
         VALUES (?, 'V', 'Hack Inova', '2099-01-01', 'online', 'https://x.dev', '[]', 'painel')`,
      )
      .run(ed);
    const text = "Regra nova da edição. ".repeat(6);
    const t = await saveEditionTerms(ed, { conductText: text, minAge: 16 }, null);
    expect(t.conductVersion).toBe(2);
    expect(t.minAge).toBe(16);
    expect(t.allowsMinors).toBe(true);
    const v1 = await db
      .prepare("SELECT text FROM edition_conduct_versions WHERE hackathonId = ? AND version = 1")
      .get<{ text: string }>(ed);
    expect(v1?.text).toBe(DEFAULT_CONDUCT);
    // mesmo texto não sobe de novo
    expect((await saveEditionTerms(ed, { conductText: text }, null)).conductVersion).toBe(2);
  });
});

describe("inscrição com termos", () => {
  it("menor numa edição 18+ é bloqueado e nada é gravado (nem a data)", async () => {
    const m = await makeMember();
    const r = await submitRegistration({
      memberId: m,
      hackathonId: ED,
      answers: {},
      consent: true,
      ip: null,
      terms: { birthDate: yearsBefore(17), conduct: true },
    });
    expect(r).toMatchObject({ ok: false, error: "under_min_age:18" });
    expect(await getRegistrationStatus(m, ED)).toBeNull();
    const n = await db.prepare("SELECT COUNT(*) AS n FROM registration_terms WHERE memberId = ?").get<{ n: number }>(m);
    expect(Number(n!.n)).toBe(0);
  });

  it("adulto: grava nascimento, idade no evento, versão do código; sem imagem não há autorização", async () => {
    const m = await makeMember();
    const r = await submitRegistration({ memberId: m, hackathonId: ED, answers: {}, consent: true, ip: null, terms: ADULT });
    expect(r).toMatchObject({ ok: true, status: "approved" });
    const t = await db
      .prepare("SELECT birthDate, ageAtEvent, conductVersion, guardianName FROM registration_terms WHERE memberId = ?")
      .get<Record<string, unknown>>(m);
    expect(t).toMatchObject({
      birthDate: "2000-01-01",
      ageAtEvent: ADULT_AGE_AT_START,
      conductVersion: 1,
      guardianName: null,
    });
    expect((await getImageConsent(m, ED)).granted).toBe(false);
    const rows = await listRegistrantsWithAnswers(ED);
    expect(rows.find((x) => x.memberId === m)).toMatchObject({
      imageConsent: false,
      ageAtEvent: ADULT_AGE_AT_START,
      conductVersion: 1,
    });
  });

  it("menor com responsável numa edição 16+: inscreve, grava o aceite e o e-mail fica skipped sem env", async () => {
    await saveEditionTerms(ED, { minAge: 16 }, null);
    const m = await makeMember();
    const r = await submitRegistration({
      memberId: m,
      hackathonId: ED,
      answers: {},
      consent: true,
      ip: null,
      terms: {
        birthDate: yearsBefore(17),
        conduct: true,
        guardian: { name: "Joana Responsável", email: "joana@resp.dev", accepted: true },
      },
    });
    expect(r).toMatchObject({ ok: true, created: true });
    const t = await db
      .prepare(
        "SELECT ageAtEvent, guardianName, guardianEmail, guardianDeclaredAt, guardianEmailStatus FROM registration_terms WHERE memberId = ?",
      )
      .get<Record<string, unknown>>(m);
    expect(t).toMatchObject({ ageAtEvent: 17, guardianName: "Joana Responsável", guardianEmail: "joana@resp.dev" });
    expect(t?.guardianDeclaredAt).toBeTruthy();
    expect(t?.guardianEmailStatus).toBe("skipped");
    const s = await termsSummaries(ED);
    expect(s[m]).toMatchObject({ minor: true, ageAtEvent: 17 });
  });

  it("uso de imagem: autoriza na inscrição, revoga depois, histórico guarda as duas datas", async () => {
    const m = await makeMember();
    await submitRegistration({
      memberId: m,
      hackathonId: ED,
      answers: {},
      consent: true,
      ip: null,
      terms: { ...ADULT, imageUse: true },
    });
    expect((await getImageConsent(m, ED)).granted).toBe(true);
    expect((await imageGrantedMembers(ED)).has(m)).toBe(true);
    const rev = await setImageConsent(m, ED, false, "perfil");
    expect(rev).toMatchObject({ ok: true, state: { granted: false } });
    // repetir o estado não duplica
    await setImageConsent(m, ED, false, "perfil");
    const hist = await getImageConsentHistory(m, ED);
    expect(hist.map((h) => [h.granted, h.source])).toEqual([
      [1, "inscricao"],
      [0, "perfil"],
    ]);
    expect((await imageGrantedMembers(ED)).has(m)).toBe(false);
    expect((await listMyImageConsents(m)).find((e) => e.hackathonId === ED)).toMatchObject({ granted: false });
  });

  it("não inscrito não mexe em uso de imagem", async () => {
    const m = await makeMember();
    expect(await setImageConsent(m, ED, true, "edicao")).toEqual({ ok: false, error: "not_registered" });
  });

  it("cancelar a inscrição apaga os termos (nascimento incluso)", async () => {
    const m = await makeMember();
    await submitRegistration({ memberId: m, hackathonId: ED, answers: {}, consent: true, ip: null, terms: ADULT });
    await unregister(m, ED);
    const n = await db.prepare("SELECT COUNT(*) AS n FROM registration_terms WHERE memberId = ?").get<{ n: number }>(m);
    expect(Number(n!.n)).toBe(0);
  });

  it("crachá marca quem não autorizou imagem (só participante inscrito)", async () => {
    const a = await makeMember();
    const b = await makeMember();
    await submitRegistration({ memberId: a, hackathonId: ED, answers: {}, consent: true, ip: null, terms: { ...ADULT, imageUse: true } });
    await submitRegistration({ memberId: b, hackathonId: ED, answers: {}, consent: true, ip: null, terms: ADULT });
    const badges = await listBadges(ED);
    expect(badges.find((x) => x.memberId === a)?.noPhoto).toBe(false);
    expect(badges.find((x) => x.memberId === b)?.noPhoto).toBe(true);
  });
});

describe("refeições", () => {
  it("conta só aprovados; opção só com check-in; alergias graves primeiro; CSV anti-fórmula", async () => {
    await saveEditionTerms(ED, { dietEnabled: true }, null);
    const a = await makeMember();
    const b = await makeMember();
    const c = await makeMember();
    await submitRegistration({
      memberId: a,
      hackathonId: ED,
      answers: {},
      consent: true,
      ip: null,
      terms: { ...ADULT, diet: ["vegano", "sem glúten"], allergies: "=amendoim", allergySevere: true },
    });
    await submitRegistration({
      memberId: b,
      hackathonId: ED,
      answers: {},
      consent: true,
      ip: null,
      terms: { ...ADULT, diet: ["vegetariano"], allergies: "camarão" },
    });
    await submitRegistration({ memberId: c, hackathonId: ED, answers: {}, consent: true, ip: null, terms: ADULT });
    // c vira pendente: não conta
    await db.prepare("UPDATE registrations SET status = 'pending' WHERE memberId = ? AND hackathonId = ?").run(c, ED);
    const all = await mealReport(ED);
    expect(all.total).toBe(2);
    expect(all.counts).toMatchObject({ vegano: 1, "sem glúten": 1, vegetariano: 1, "sem lactose": 0 });
    expect(all.allergies.map((x) => x.severe)).toEqual([true, false]);
    const regB = await db
      .prepare("SELECT id FROM registrations WHERE memberId = ? AND hackathonId = ?")
      .get<{ id: number }>(b, ED);
    await db.prepare("INSERT INTO checkins (registrationId) VALUES (?)").run(regB!.id);
    const present = await mealReport(ED, { checkedInOnly: true });
    expect(present.total).toBe(1);
    expect(present.counts.vegetariano).toBe(1);
    expect(present.counts.vegano).toBe(0);
    const csv = mealsCsv(all);
    expect(csv).toContain("vegano,1");
    expect(csv).toContain("'=amendoim");
  });
});

describe("incidentes", () => {
  it("valida tipo e descrição", () => {
    expect(validateIncident({ kind: "x", description: "algo aconteceu aqui" })).toMatchObject({ ok: false });
    expect(validateIncident({ kind: "assedio", description: "curto" })).toMatchObject({ ok: false });
    expect(validateIncident({ kind: "assedio", description: "algo aconteceu aqui" })).toMatchObject({ ok: true });
  });

  it("anônimo não grava autor; logado com anonymous=true também não", async () => {
    const m = await makeMember();
    const v = validateIncident({ kind: "outro", description: "relato de teste anônimo", anonymous: true });
    if (!v.ok) throw new Error(v.error);
    await createIncident(ED, v.value, m);
    await createIncident(ED, { ...v.value, anonymous: false }, null);
    const rows = await db.prepare("SELECT reporterId FROM incidents WHERE hackathonId = ?").all<{ reporterId: number | null }>(ED);
    expect(rows.map((r) => r.reporterId)).toEqual([null, null]);
    const cols = await db
      .prepare("SELECT column_name FROM information_schema.columns WHERE table_name = 'incidents'")
      .all<{ column_name: string }>();
    expect(cols.map((c) => c.column_name)).not.toContain("ip");
  });

  it("notifica organizador e responsável de conduta, não o staff; staff não acessa a fila", async () => {
    const org = await makeMember();
    const staff = await makeMember();
    const handler = await makeMember();
    await grantEditionRole(ED, org, "organizador", null);
    await grantEditionRole(ED, staff, "staff", null);
    await grantEditionRole(ED, handler, "staff", null);
    expect(await setConductHandler(ED, handler, true, org)).toBe(true);
    // fora da equipe não vira responsável
    expect(await setConductHandler(ED, await makeMember(), true, org)).toBe(false);
    const v = validateIncident({ kind: "assedio", description: "alguém foi inconveniente no coffee" });
    if (!v.ok) throw new Error(v.error);
    await createIncident(ED, v.value, null);
    const notified = await db
      .prepare("SELECT memberId FROM notifications WHERE type = 'incident' AND memberId IN (?, ?, ?)")
      .all<{ memberId: number }>(org, staff, handler);
    expect(notified.map((n) => n.memberId).sort()).toEqual([org, handler].sort());
    expect(await canHandleIncidents({ id: staff, role: "member" }, ED)).toBe(false);
    expect(await canHandleIncidents({ id: handler, role: "member" }, ED)).toBe(true);
    expect(await canHandleIncidents({ id: org, role: "member" }, ED)).toBe(true);
    const [inc] = await listIncidents(ED);
    expect(inc).toMatchObject({ status: "aberto", anonymous: true });
    expect(await updateIncident(ED, inc.id, { status: "em_andamento", internalNote: "falei com a pessoa" }, org)).toBe(true);
    expect((await listIncidents(ED))[0]).toMatchObject({ status: "em_andamento", internalNote: "falei com a pessoa" });
    // só status mantém a nota
    await updateIncident(ED, inc.id, { status: "resolvido" }, org);
    expect((await listIncidents(ED))[0]).toMatchObject({ status: "resolvido", internalNote: "falei com a pessoa" });
    expect(await updateIncident("outra-edicao", inc.id, { status: "aberto" }, org)).toBe(false);
  });
});

describe("LGPD — export e exclusão cobrem os termos", () => {
  it("export traz nascimento, uso de imagem e denúncia sem a nota interna; exclusão apaga termos e anonimiza o autor", async () => {
    const m = await makeMember();
    await submitRegistration({
      memberId: m,
      hackathonId: ED,
      answers: {},
      consent: true,
      ip: null,
      terms: { ...ADULT, imageUse: true },
    });
    // edição encerrada: inscrição aprovada fica (anonimizada), os termos não
    const reg = await db
      .prepare("INSERT INTO registrations (memberId, hackathonId) VALUES (?, ?) RETURNING id")
      .get<{ id: number }>(m, PAST);
    await db
      .prepare(
        `INSERT INTO edition_conduct_versions (hackathonId, version, text) VALUES (?, 1, 'x')
         ON CONFLICT DO NOTHING`,
      )
      .run(PAST);
    await db
      .prepare(
        `INSERT INTO registration_terms (registrationId, memberId, hackathonId, birthDate, ageAtEvent, conductVersion)
         VALUES (?, ?, ?, '1999-09-09', 20, 1)`,
      )
      .run(reg!.id, m, PAST);
    const v = validateIncident({ kind: "outro", description: "relato com autor identificado", contact: "zap 11 9" });
    if (!v.ok) throw new Error(v.error);
    const inc = await createIncident(ED, v.value, m);
    await updateIncident(ED, inc.id, { internalNote: "nota interna sigilosa" }, m);

    const out = await exportMemberData(m);
    const terms = out!.data["registration_terms.memberId"] as { birthDate: string }[];
    expect(terms.map((t) => t.birthDate).sort()).toEqual(["1999-09-09", "2000-01-01"]);
    expect(out!.data["image_consents.memberId"]).toHaveLength(1);
    const incs = out!.data["incidents.reporterId"] as Record<string, unknown>[];
    expect(incs).toHaveLength(1);
    expect(incs[0]).not.toHaveProperty("internalNote");
    expect(out!.data["incidents.updatedBy"]).toBeUndefined();

    await deleteMemberData(m);
    const left = await db.prepare("SELECT COUNT(*) AS n FROM registration_terms WHERE memberId = ?").get<{ n: number }>(m);
    expect(Number(left!.n)).toBe(0);
    const img = await db.prepare("SELECT COUNT(*) AS n FROM image_consents WHERE memberId = ?").get<{ n: number }>(m);
    expect(Number(img!.n)).toBe(0);
    const row = await db
      .prepare("SELECT reporterId, contact, description FROM incidents WHERE id = ?")
      .get<Record<string, unknown>>(inc.id);
    expect(row).toMatchObject({ reporterId: null, contact: null, description: "relato com autor identificado" });
    // a inscrição da edição encerrada continua (contagem), sem o nascimento
    expect(await getRegistrationStatus(m, PAST)).toBe("approved");
  });
});

describe("plataforma sem menor (decisão do dono, 14/10/2026)", () => {
  it("sem HACKAHUB_ALLOW_MINORS o piso é 18: recusa 16 e valor antigo abaixo vale 18", async () => {
    const prev = process.env.HACKAHUB_ALLOW_MINORS;
    delete process.env.HACKAHUB_ALLOW_MINORS;
    try {
      const { minAgeFloor, validateTermsPatch } = await import("@/lib/eventTerms");
      expect(minAgeFloor()).toBe(18);
      expect(validateTermsPatch({ minAge: 16 }).ok).toBe(false);
      expect(validateTermsPatch({ minAge: 18 }).ok).toBe(true);
    } finally {
      process.env.HACKAHUB_ALLOW_MINORS = prev;
    }
  });
});
