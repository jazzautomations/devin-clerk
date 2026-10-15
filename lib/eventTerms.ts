import db from "@/lib/db";
import { hostedSql } from "@/lib/hackathons";
import { emailDriver, emailReplyTo } from "@/lib/notify/email";
import type { DriverEnv, SendOutcome } from "@/lib/notify/types";
import { absoluteUrl } from "@/lib/seo";

// Termos do evento (roadmap 037 #3, #6, #7; pesquisa 035 itens 4, 8, 9 e
// riscos 3–4). Tudo o que a inscrição pede além das perguntas da edição:
//
// - idade mínima por edição (padrão 18). Pede a data de nascimento e
//   bloqueia quem fica abaixo da mínima na data do evento. Se a edição
//   aceita menor (mínima < 18), o menor informa nome e e-mail do
//   responsável e declara o aceite dele; o responsável recebe um e-mail.
//   É o mínimo aceitável, não verificação de identidade — edição com menor
//   precisa de parecer jurídico (035 risco 4), e o painel avisa isso.
// - código de conduta versionado: aceite obrigatório, gravado com a versão.
// - uso de imagem: caixa separada, opcional, nunca marcada, revogável.
// - restrição alimentar: pergunta padrão que o organizador liga.
//
// Dado mínimo: a data de nascimento fica só em registration_terms (some
// quando a inscrição é cancelada ou a conta excluída) e o painel mostra a
// idade no evento, nunca a data. Quem fica abaixo da mínima não grava nada.

export const DEFAULT_MIN_AGE = 18;
export const ADULT_AGE = 18;
/** decisão do dono (14/10/2026): o HackaHub não trabalha com menor. A edição
 * só aceita idade mínima abaixo de 18 com HACKAHUB_ALLOW_MINORS=on (o fluxo do
 * responsável continua no código, testado, pra quando houver parecer jurídico) */
export const MINORS_FLOOR = 14;
export function minAgeFloor(): number {
  return process.env.HACKAHUB_ALLOW_MINORS === "on" ? MINORS_FLOOR : ADULT_AGE;
}
const MAX_CONDUCT = 20_000;
const MIN_CONDUCT = 80;

export const DIET_OPTIONS = ["vegetariano", "vegano", "sem glúten", "sem lactose"] as const;
export type DietOption = (typeof DIET_OPTIONS)[number];

// Texto próprio (inspirado na estrutura dos códigos do MLH e do Hack Club,
// sem copiar texto deles). O organizador pode editar por edição.
export const DEFAULT_CONDUCT = `Código de conduta

Esta edição existe pra gente aprender, construir e se divertir junto. Pra isso todo mundo precisa se sentir seguro. Este código vale pra participantes, mentores, jurados, voluntários, patrocinadores e organização, no local do evento, nos canais online e nas redes sociais ligadas a ele.

O que esperamos de todo mundo
- Tratar as pessoas com respeito, inclusive quando discordar.
- Ajudar quem está começando. Ninguém nasce sabendo.
- Respeitar o espaço físico, os equipamentos e as regras do local.
- Pedir consentimento antes de fotografar ou filmar alguém de perto, e respeitar quem usa o sinal de "sem foto" no crachá.
- Cuidar de si e dos outros: beber água, dormir um pouco, avisar a organização se alguém precisar de ajuda.

O que não aceitamos
- Assédio de qualquer tipo, incluindo comentários, contato físico ou atenção sexual indesejados.
- Discriminação ou ofensa por gênero, identidade de gênero, orientação sexual, raça, etnia, religião, origem, idade, deficiência, aparência ou nível de experiência.
- Intimidação, perseguição, ameaça ou incentivo à violência.
- Fotografar, gravar ou expor alguém sem autorização, ou divulgar dado pessoal de outra pessoa.
- Interromper de propósito palestras, apresentações ou o trabalho dos times.
- Projeto com conteúdo ofensivo, ilegal ou feito pra prejudicar alguém.
- Consumo de álcool ou outras drogas por menores, e qualquer conduta que coloque menores em risco.

Se acontecer com você ou você presenciar
Procure qualquer pessoa da organização ou use o canal de denúncia da edição, que aceita relato anônimo. A organização trata todo relato com sigilo, ouve as pessoas envolvidas e responde o mais rápido possível. Em caso de risco imediato, ligue 190 (polícia) ou 192 (SAMU).

Consequências
Quem descumprir este código pode receber advertência, ser retirado do evento sem reembolso, ser desclassificado e ser impedido de participar de próximas edições. Situações que configurem crime serão levadas às autoridades.

Ninguém sofre retaliação por relatar um problema de boa-fé.`;

// ---------- configuração da edição ----------

export type EditionTerms = {
  hackathonId: string;
  minAge: number;
  dietEnabled: boolean;
  conductVersion: number;
  conductText: string;
  /** a edição aceita menor de 18 (com responsável) */
  allowsMinors: boolean;
};

export async function getEditionTerms(hackathonId: string): Promise<EditionTerms> {
  const [cfg, conduct] = await Promise.all([
    db
      .prepare('SELECT minAge, dietEnabled FROM edition_terms WHERE hackathonId = ?')
      .get<{ minAge: number; dietEnabled: number }>(hackathonId),
    db
      .prepare(
        "SELECT version, text FROM edition_conduct_versions WHERE hackathonId = ? ORDER BY version DESC LIMIT 1",
      )
      .get<{ version: number; text: string }>(hackathonId),
  ]);
  // valor antigo abaixo do piso (edição criada antes da trava) vale o piso
  const minAge = Math.max(cfg?.minAge ?? DEFAULT_MIN_AGE, minAgeFloor());
  return {
    hackathonId,
    minAge,
    dietEnabled: cfg?.dietEnabled === 1,
    // sem versão gravada, o texto padrão é a versão 1 (gravada no 1º aceite)
    conductVersion: conduct?.version ?? 1,
    conductText: conduct?.text ?? DEFAULT_CONDUCT,
    allowsMinors: minAge < ADULT_AGE,
  };
}

/** garante a versão 1 (texto padrão) e devolve a versão vigente */
export async function ensureConductVersion(hackathonId: string): Promise<number> {
  await db
    .prepare(
      `INSERT INTO edition_conduct_versions (hackathonId, version, text)
       SELECT ?, 1, ? WHERE NOT EXISTS (SELECT 1 FROM edition_conduct_versions WHERE hackathonId = ?)
       ON CONFLICT DO NOTHING`,
    )
    .run(hackathonId, DEFAULT_CONDUCT, hackathonId);
  const row = await db
    .prepare("SELECT MAX(version) AS v FROM edition_conduct_versions WHERE hackathonId = ?")
    .get<{ v: number }>(hackathonId);
  return Number(row?.v ?? 1);
}

export type TermsPatch = { minAge?: number; dietEnabled?: boolean; conductText?: string };

export function validateTermsPatch(raw: unknown): { ok: true; value: TermsPatch } | { ok: false; error: string } {
  const b = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!b) return { ok: false, error: "corpo inválido" };
  const out: TermsPatch = {};
  if (b.minAge !== undefined) {
    const n = Number(b.minAge);
    const floor = minAgeFloor();
    if (!Number.isInteger(n) || n < floor || n > 99) {
      return { ok: false, error: `idade mínima entre ${floor} e 99` };
    }
    out.minAge = n;
  }
  if (b.dietEnabled !== undefined) {
    if (typeof b.dietEnabled !== "boolean") return { ok: false, error: "dietEnabled precisa ser true/false" };
    out.dietEnabled = b.dietEnabled;
  }
  if (b.conductText !== undefined) {
    const t = typeof b.conductText === "string" ? b.conductText.replace(/\r\n/g, "\n").trim() : "";
    if (t.length < MIN_CONDUCT) return { ok: false, error: `código de conduta com pelo menos ${MIN_CONDUCT} caracteres` };
    if (t.length > MAX_CONDUCT) return { ok: false, error: `código de conduta com até ${MAX_CONDUCT} caracteres` };
    out.conductText = t;
  }
  if (Object.keys(out).length === 0) return { ok: false, error: "nada pra salvar" };
  return { ok: true, value: out };
}

/** salva a configuração; texto de conduta diferente sobe a versão (a antiga fica congelada) */
export async function saveEditionTerms(hackathonId: string, patch: TermsPatch, actorId: number | null) {
  return db.transaction(async () => {
    const cur = await getEditionTerms(hackathonId);
    if (patch.minAge !== undefined || patch.dietEnabled !== undefined) {
      await db
        .prepare(
          `INSERT INTO edition_terms (hackathonId, minAge, dietEnabled, updatedBy)
           VALUES (?, ?, ?, ?)
           ON CONFLICT ("hackathonId") DO UPDATE SET
             minAge = excluded.minAge, dietEnabled = excluded.dietEnabled,
             updatedBy = excluded.updatedBy, updatedAt = datetime('now')`,
        )
        .run(
          hackathonId,
          patch.minAge ?? cur.minAge,
          (patch.dietEnabled ?? cur.dietEnabled) ? 1 : 0,
          actorId,
        );
    }
    const text = patch.conductText?.replace(/\r\n/g, "\n").trim();
    if (text !== undefined && text !== cur.conductText.trim()) {
      const v = await ensureConductVersion(hackathonId);
      await db
        .prepare(
          "INSERT INTO edition_conduct_versions (hackathonId, version, text, createdBy) VALUES (?, ?, ?, ?)",
        )
        .run(hackathonId, v + 1, text, actorId);
    }
    return getEditionTerms(hackathonId);
  })();
}

// ---------- idade ----------

/** "YYYY-MM-DD" do início do evento (startsAt pode vir com hora) */
export function eventDay(startsAt: string): string {
  if (/^\d{4}-\d{2}-\d{2}/.test(startsAt)) return startsAt.slice(0, 10);
  const d = new Date(startsAt);
  return Number.isNaN(d.getTime()) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10);
}

/** anos completos em `on` (YYYY-MM-DD) pra quem nasceu em `birth` (YYYY-MM-DD) */
export function ageOn(birth: string, on: string): number {
  const [by, bm, bd] = birth.split("-").map(Number);
  const [y, m, d] = on.split("-").map(Number);
  let age = y - by;
  if (m < bm || (m === bm && d < bd)) age--;
  return age;
}

export function parseBirthDate(raw: unknown, today = new Date()): string | null {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [y, m, d] = raw.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  if (y < 1900 || raw > today.toISOString().slice(0, 10)) return null;
  return raw;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// ---------- validação do que a inscrição manda ----------

export type ValidTerms = {
  birthDate: string;
  ageAtEvent: number;
  minor: boolean;
  guardian: { name: string; email: string } | null;
  conductVersion: number;
  imageUse: boolean;
  diet: DietOption[];
  allergies: string | null;
  allergySevere: boolean;
};

export type TermsError = { ok: false; error: string; message: string };

/**
 * Valida o bloco `terms` da inscrição contra a configuração da edição.
 * Erros com código (pra API) e texto claro (pra pessoa).
 */
export function validateRegistrationTerms(
  raw: unknown,
  ctx: { terms: EditionTerms; startsAt: string; memberEmail?: string | null; today?: Date },
): { ok: true; value: ValidTerms } | TermsError {
  const b = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const fail = (error: string, message: string): TermsError => ({ ok: false, error, message });
  const { terms } = ctx;

  if (b.birthDate === undefined || b.birthDate === null || b.birthDate === "") {
    return fail("birth_date_required", "informe sua data de nascimento");
  }
  const birthDate = parseBirthDate(b.birthDate, ctx.today);
  if (!birthDate) return fail("birth_date_invalid", "data de nascimento inválida");
  const ageAtEvent = ageOn(birthDate, eventDay(ctx.startsAt));
  if (ageAtEvent < terms.minAge) {
    return fail(
      `under_min_age:${terms.minAge}`,
      `Esta edição é para quem tem ${terms.minAge} anos ou mais na data do evento. Pela data informada, você ainda não pode se inscrever nela.`,
    );
  }
  const minor = ageAtEvent < ADULT_AGE;
  let guardian: ValidTerms["guardian"] = null;
  if (minor) {
    const g = b.guardian && typeof b.guardian === "object" ? (b.guardian as Record<string, unknown>) : {};
    const name = typeof g.name === "string" ? g.name.trim() : "";
    const email = typeof g.email === "string" ? g.email.trim().toLowerCase() : "";
    if (name.length < 3 || name.length > 120) {
      return fail("guardian_required", "menor de 18 precisa informar o nome completo do responsável legal");
    }
    if (!EMAIL_RE.test(email) || email.length > 200) {
      return fail("guardian_email_invalid", "informe um e-mail válido do responsável legal");
    }
    if (ctx.memberEmail && email === ctx.memberEmail.trim().toLowerCase()) {
      return fail("guardian_email_same", "o e-mail do responsável precisa ser diferente do seu");
    }
    if (g.accepted !== true) {
      return fail("guardian_consent_required", "confirme que seu responsável legal autorizou a participação");
    }
    guardian = { name, email };
  }

  if (b.conduct !== true) return fail("conduct_required", "aceite o código de conduta da edição pra concluir");
  if (b.conductVersion !== undefined && b.conductVersion !== null && Number(b.conductVersion) !== terms.conductVersion) {
    return fail(
      "conduct_outdated",
      "o código de conduta desta edição foi atualizado enquanto você preenchia. Recarregue a página e leia a versão nova.",
    );
  }

  let diet: DietOption[] = [];
  let allergies: string | null = null;
  let allergySevere = false;
  if (terms.dietEnabled) {
    const rawDiet = Array.isArray(b.diet) ? b.diet : [];
    if (rawDiet.some((x) => typeof x !== "string" || !(DIET_OPTIONS as readonly string[]).includes(x))) {
      return fail("diet_invalid", "restrição alimentar inválida");
    }
    diet = [...new Set(rawDiet as DietOption[])];
    const a = typeof b.allergies === "string" ? b.allergies.trim() : "";
    if (a.length > 500) return fail("allergies_too_long", "alergias: até 500 caracteres");
    allergies = a || null;
    allergySevere = Boolean(allergies) && b.allergySevere === true;
  }

  return {
    ok: true,
    value: {
      birthDate,
      ageAtEvent,
      minor,
      guardian,
      conductVersion: terms.conductVersion,
      // só `true` explícito vale como autorização (nunca pré-marcado)
      imageUse: b.imageUse === true,
      diet,
      allergies,
      allergySevere,
    },
  };
}

/** grava os termos aceitos (chamar na transação que criou a inscrição) */
export async function saveRegistrationTerms(input: {
  registrationId: number;
  memberId: number;
  hackathonId: string;
  terms: ValidTerms;
  imagePurpose: string;
}) {
  const t = input.terms;
  const version = await ensureConductVersion(input.hackathonId);
  await db
    .prepare(
      `INSERT INTO registration_terms
         (registrationId, memberId, hackathonId, birthDate, ageAtEvent, conductVersion,
          guardianName, guardianEmail, guardianDeclaredAt, diet, allergies, allergySevere)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${t.guardian ? "datetime('now')" : "NULL"}, ?, ?, ?)`,
    )
    .run(
      input.registrationId,
      input.memberId,
      input.hackathonId,
      t.birthDate,
      t.ageAtEvent,
      version,
      t.guardian?.name ?? null,
      t.guardian?.email ?? null,
      JSON.stringify(t.diet),
      t.allergies,
      t.allergySevere ? 1 : 0,
    );
  if (t.imageUse) {
    await recordImageConsent(input.memberId, input.hackathonId, true, "inscricao", input.imagePurpose);
  }
}

// ---------- uso de imagem ----------

export function imagePurpose(organizer: string, editionName: string): string {
  return (
    `Autorizo ${organizer} a usar fotos e vídeos em que eu apareça, feitos durante ${editionName}, ` +
    `para divulgar este evento e as próximas edições (site, redes sociais e imprensa), sem fins comerciais ` +
    `e sem pagamento. Posso revogar quando quiser pelo meu perfil: o que já foi publicado não é recolhido, ` +
    `mas não entra em material novo.`
  );
}

export async function imagePurposeFor(hackathonId: string): Promise<string> {
  const h = await db
    .prepare("SELECT name, organizer FROM hackathons WHERE id = ?")
    .get<{ name: string; organizer: string }>(hackathonId);
  return imagePurpose(h?.organizer ?? "a organização", h?.name ?? "esta edição");
}

async function recordImageConsent(
  memberId: number,
  hackathonId: string,
  granted: boolean,
  source: "inscricao" | "perfil" | "edicao",
  purpose: string,
) {
  await db
    .prepare(
      "INSERT INTO image_consents (memberId, hackathonId, granted, purpose, source) VALUES (?, ?, ?, ?, ?)",
    )
    .run(memberId, hackathonId, granted ? 1 : 0, purpose, source);
}

export type ImageConsentState = { granted: boolean; at: string | null };

export async function getImageConsent(memberId: number, hackathonId: string): Promise<ImageConsentState> {
  const row = await db
    .prepare(
      `SELECT granted, createdAt FROM image_consents
       WHERE memberId = ? AND hackathonId = ? ORDER BY id DESC LIMIT 1`,
    )
    .get<{ granted: number; createdAt: string }>(memberId, hackathonId);
  return { granted: row?.granted === 1, at: row?.createdAt ?? null };
}

export async function getImageConsentHistory(memberId: number, hackathonId: string) {
  return db
    .prepare(
      `SELECT granted, source, createdAt FROM image_consents
       WHERE memberId = ? AND hackathonId = ? ORDER BY id`,
    )
    .all<{ granted: number; source: string; createdAt: string }>(memberId, hackathonId);
}

/**
 * Autoriza ou revoga o uso de imagem numa edição em que a pessoa está
 * inscrita. Sempre acrescenta uma linha (histórico é a prova); repetir o
 * estado atual não grava nada.
 */
export async function setImageConsent(
  memberId: number,
  hackathonId: string,
  granted: boolean,
  source: "perfil" | "edicao",
): Promise<{ ok: true; state: ImageConsentState } | { ok: false; error: "not_registered" }> {
  const reg = await db
    .prepare("SELECT 1 AS x FROM registrations WHERE memberId = ? AND hackathonId = ?")
    .get(memberId, hackathonId);
  if (!reg) return { ok: false, error: "not_registered" };
  const cur = await getImageConsent(memberId, hackathonId);
  if (cur.granted !== granted || cur.at === null) {
    await recordImageConsent(memberId, hackathonId, granted, source, await imagePurposeFor(hackathonId));
  }
  return { ok: true, state: await getImageConsent(memberId, hackathonId) };
}

/** membros da edição com autorização de imagem vigente */
export async function imageGrantedMembers(hackathonId: string): Promise<Set<number>> {
  const rows = await db
    .prepare(
      `SELECT memberId FROM (
         SELECT DISTINCT ON (memberId) memberId, granted
         FROM image_consents WHERE hackathonId = ? ORDER BY memberId, id DESC
       ) last WHERE granted = 1`,
    )
    .all<{ memberId: number }>(hackathonId);
  return new Set(rows.map((r) => r.memberId));
}

export type MyEditionConsent = { hackathonId: string; name: string; granted: boolean; at: string | null };

/** edições em que a pessoa está inscrita + estado do uso de imagem (perfil) */
export async function listMyImageConsents(memberId: number): Promise<MyEditionConsent[]> {
  return (
    await db
      .prepare(
        `SELECT h.id AS hackathonId, h.name, ic.granted, ic.createdAt AS at
         FROM registrations r
         JOIN hackathons h ON h.id = r.hackathonId
         LEFT JOIN LATERAL (
           SELECT granted, createdAt FROM image_consents
           WHERE memberId = r.memberId AND hackathonId = r.hackathonId ORDER BY id DESC LIMIT 1
         ) ic ON true
         WHERE r.memberId = ? AND ${hostedSql('h')}
         ORDER BY h.startsAt DESC`,
      )
      .all<{ hackathonId: string; name: string; granted: number | null; at: string | null }>(memberId)
  ).map((r) => ({ hackathonId: r.hackathonId, name: r.name, granted: r.granted === 1, at: r.at }));
}

// ---------- responsável legal ----------

export type TermsSummary = {
  ageAtEvent: number;
  minor: boolean;
  guardianName: string | null;
  guardianEmailStatus: string | null;
  conductVersion: number;
};

/** resumo pro painel: idade no evento (nunca a data), menor, versão do código */
export async function termsSummaries(hackathonId: string): Promise<Record<number, TermsSummary>> {
  const rows = await db
    .prepare(
      `SELECT memberId, ageAtEvent, guardianName, guardianEmailStatus, conductVersion
       FROM registration_terms WHERE hackathonId = ?`,
    )
    .all<{
      memberId: number;
      ageAtEvent: number;
      guardianName: string | null;
      guardianEmailStatus: string | null;
      conductVersion: number;
    }>(hackathonId);
  return Object.fromEntries(
    rows.map((r) => [
      r.memberId,
      {
        ageAtEvent: r.ageAtEvent,
        minor: r.ageAtEvent < ADULT_AGE,
        guardianName: r.guardianName,
        guardianEmailStatus: r.guardianEmailStatus,
        conductVersion: r.conductVersion,
      },
    ]),
  );
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Avisa o responsável legal por e-mail (driver existente: sem RESEND_API_KEY
 * fica `skipped`). Grava o desfecho em registration_terms. Nunca lança.
 */
export async function sendGuardianEmail(registrationId: number, env: DriverEnv = process.env): Promise<SendOutcome> {
  const row = await db
    .prepare(
      `SELECT t.guardianName, t.guardianEmail, t.ageAtEvent, m.name, m.username, h.id AS hackathonId,
              h.name AS edition, h.organizer, h.startsAt
       FROM registration_terms t
       JOIN members m ON m.id = t.memberId
       JOIN hackathons h ON h.id = t.hackathonId
       WHERE t.registrationId = ?`,
    )
    .get<{
      guardianName: string | null;
      guardianEmail: string | null;
      ageAtEvent: number;
      name: string | null;
      username: string;
      hackathonId: string;
      edition: string;
      organizer: string;
      startsAt: string;
    }>(registrationId);
  if (!row?.guardianEmail) return { status: "skipped", reason: "sem responsável" };
  const who = row.name?.trim() || `@${row.username}`;
  const conduct = absoluteUrl(`/h/${row.hackathonId}/conduta`);
  const page = absoluteUrl(`/h/${row.hackathonId}`);
  const subject = `${who} se inscreveu em ${row.edition} indicando você como responsável`;
  const text = [
    `Olá, ${row.guardianName}.`,
    "",
    `${who} (${row.ageAtEvent} anos na data do evento) se inscreveu na edição ${row.edition}, organizada por ${row.organizer}, e informou que você é o responsável legal e autorizou a participação.`,
    "",
    `Código de conduta da edição: ${conduct}`,
    `Página do evento: ${page}`,
    "",
    // "responda este e-mail" só quando a resposta chega em alguém: sem
    // reply-to configurado, o remetente é um endereço que ninguém lê
    emailReplyTo(env)
      ? `Se você NÃO autorizou, responda este e-mail ou fale com ${row.organizer} antes do evento. A inscrição será cancelada.`
      : `Se você NÃO autorizou, avise ${row.organizer} antes do evento. A inscrição será cancelada.`,
  ].join("\n");
  const html = text
    .split("\n")
    .map((l) => (l ? `<p>${esc(l)}</p>` : ""))
    .join("");
  let outcome: SendOutcome;
  try {
    outcome = await emailDriver(env).send({
      to: row.guardianEmail,
      subject,
      text,
      html,
      idempotencyKey: `guardian-${registrationId}`,
    });
  } catch (e) {
    outcome = { status: "failed", error: e instanceof Error ? e.message : String(e) };
  }
  await db
    .prepare("UPDATE registration_terms SET guardianEmailStatus = ? WHERE registrationId = ?")
    .run(outcome.status, registrationId);
  return outcome;
}

// ---------- refeições ----------

export type MealReport = {
  total: number;
  semRestricao: number;
  counts: Record<DietOption, number>;
  allergies: { name: string; username: string; text: string; severe: boolean; checkedIn: boolean }[];
};

/**
 * Relatório pro buffet: só inscrição aprovada (opção: só quem fez check-in).
 * Alergias com as graves primeiro.
 */
export async function mealReport(hackathonId: string, opts: { checkedInOnly?: boolean } = {}): Promise<MealReport> {
  const rows = await db
    .prepare(
      `SELECT m.name, m.username, t.diet, t.allergies, t.allergySevere,
              (c.registrationId IS NOT NULL) AS "checkedIn"
       FROM registrations r
       JOIN members m ON m.id = r.memberId
       LEFT JOIN registration_terms t ON t.registrationId = r.id
       LEFT JOIN checkins c ON c.registrationId = r.id
       WHERE r.hackathonId = ? AND r.status = 'approved'
         ${opts.checkedInOnly ? "AND c.registrationId IS NOT NULL" : ""}`,
    )
    .all<{
      name: string | null;
      username: string;
      diet: string | null;
      allergies: string | null;
      allergySevere: number | null;
      checkedIn: boolean;
    }>(hackathonId);
  const counts = Object.fromEntries(DIET_OPTIONS.map((o) => [o, 0])) as Record<DietOption, number>;
  let semRestricao = 0;
  const allergies: MealReport["allergies"] = [];
  for (const r of rows) {
    let diet: string[] = [];
    try {
      const v = JSON.parse(r.diet ?? "[]");
      diet = Array.isArray(v) ? v : [];
    } catch {
      diet = [];
    }
    const known = diet.filter((d): d is DietOption => (DIET_OPTIONS as readonly string[]).includes(d));
    for (const d of known) counts[d]++;
    if (known.length === 0 && !r.allergies) semRestricao++;
    if (r.allergies) {
      allergies.push({
        name: r.name?.trim() || `@${r.username}`,
        username: r.username,
        text: r.allergies,
        severe: r.allergySevere === 1,
        checkedIn: Boolean(r.checkedIn),
      });
    }
  }
  const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });
  allergies.sort((a, b) => Number(b.severe) - Number(a.severe) || collator.compare(a.name, b.name));
  return { total: rows.length, semRestricao, counts, allergies };
}

function csvCell(raw: string | number | null | undefined): string {
  let s = raw === null || raw === undefined ? "" : String(raw);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function mealsCsv(r: MealReport, opts: { checkedInOnly?: boolean } = {}): string {
  const lines = [
    ["relatorio", opts.checkedInOnly ? "so com check-in" : "aprovados"],
    ["total", r.total],
    ["sem restricao", r.semRestricao],
    ...DIET_OPTIONS.map((o) => [o, r.counts[o]]),
    [],
    ["nome", "username", "alergia", "grave", "check-in"],
    ...r.allergies.map((a) => [a.name, a.username, a.text, a.severe ? "sim" : "nao", a.checkedIn ? "sim" : "nao"]),
  ];
  return lines.map((l) => l.map(csvCell).join(",")).join("\n") + "\n";
}
