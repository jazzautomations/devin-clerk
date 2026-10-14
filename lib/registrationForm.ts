import db from "@/lib/db";
import type { Badge } from "@/lib/game";
import {
  completeRegistration,
  getRegistrationStatus,
  register,
  type RegistrationStatus,
} from "@/lib/registrations";

// spec 033 US1 — formulário de inscrição por edição (substitui o Google
// Forms) + consentimento LGPD (FR-002). Perguntas tipadas e versionadas:
// a pergunta "viva" fica em edition_questions; cada versão de texto/opções
// é congelada em edition_question_versions e a resposta aponta pra versão
// que o inscrito viu. Nome, e-mail e GitHub vêm do perfil — nunca viram pergunta.

export const QUESTION_KINDS = ["short_text", "long_text", "single", "multi", "yes_no"] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

// público do formulário (frente E): participante é a inscrição; os outros
// são os tipos de candidatura (lib/roleApplications). Cada público tem o
// próprio formulário na mesma tabela de perguntas.
export const AUDIENCES = ["participante", "voluntario", "mentor", "jurado"] as const;
export type Audience = (typeof AUDIENCES)[number];

export function isAudience(v: unknown): v is Audience {
  return typeof v === "string" && (AUDIENCES as readonly string[]).includes(v);
}

export const KIND_LABEL: Record<QuestionKind, string> = {
  short_text: "texto curto",
  long_text: "texto longo",
  single: "escolha única",
  multi: "múltipla escolha",
  yes_no: "sim/não",
};

// versão dos termos + política (app/legal). Mudou o texto jurídico → sobe
// aqui; o consentimento gravado guarda a versão aceita.
export const TERMS_VERSION = "2026-10-14";

const MAX_LABEL = 200;
const MAX_OPTIONS = 30;
const MAX_SHORT = 200;
const MAX_LONG = 2000;

export type EditionQuestion = {
  id: number;
  hackathonId: string;
  audience: Audience;
  version: number;
  kind: QuestionKind;
  label: string;
  options: string[];
  required: boolean;
  position: number;
  archived: boolean;
};

type QuestionRow = Omit<EditionQuestion, "options" | "required" | "archived"> & {
  options: string;
  required: number;
  archived: number;
};

const toQuestion = (r: QuestionRow): EditionQuestion => ({
  ...r,
  options: parseOptions(r.options),
  required: r.required === 1,
  archived: r.archived === 1,
});

function parseOptions(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export type QuestionInput = { kind: QuestionKind; label: string; options: string[]; required: boolean };

export function isQuestionKind(v: unknown): v is QuestionKind {
  return typeof v === "string" && (QUESTION_KINDS as readonly string[]).includes(v);
}

/** valida/normaliza o payload do admin (criar ou editar pergunta) */
export function validateQuestionInput(
  raw: unknown,
): { ok: true; value: QuestionInput } | { ok: false; error: string } {
  const b = (raw ?? {}) as Record<string, unknown>;
  if (!isQuestionKind(b.kind)) return { ok: false, error: "tipo de pergunta inválido" };
  const label = typeof b.label === "string" ? b.label.trim() : "";
  if (!label) return { ok: false, error: "a pergunta precisa de um texto" };
  if (label.length > MAX_LABEL) return { ok: false, error: `pergunta com até ${MAX_LABEL} caracteres` };
  const rawOptions = Array.isArray(b.options) ? b.options : [];
  const options = [
    ...new Set(rawOptions.filter((o): o is string => typeof o === "string").map((o) => o.trim()).filter(Boolean)),
  ];
  const needsOptions = b.kind === "single" || b.kind === "multi";
  if (needsOptions && options.length < 2) return { ok: false, error: "escolha precisa de pelo menos 2 opções" };
  if (options.length > MAX_OPTIONS) return { ok: false, error: `no máximo ${MAX_OPTIONS} opções` };
  return {
    ok: true,
    value: { kind: b.kind, label, options: needsOptions ? options : [], required: b.required === true },
  };
}

const QUESTION_COLS = "id, hackathonId, audience, version, kind, label, options, required, position, archived";

/** perguntas de UM público (default participante = formulário de inscrição) */
export async function listQuestions(
  hackathonId: string,
  opts: { includeArchived?: boolean; audience?: Audience } = {},
): Promise<EditionQuestion[]> {
  const rows = await db
    .prepare(
      `SELECT ${QUESTION_COLS}
       FROM edition_questions
       WHERE hackathonId = ? AND audience = ? ${opts.includeArchived ? "" : "AND archived = 0"}
       ORDER BY archived, position, id`,
    )
    .all<QuestionRow>(hackathonId, opts.audience ?? "participante");
  return rows.map(toQuestion);
}

async function getQuestion(hackathonId: string, questionId: number): Promise<EditionQuestion | null> {
  const row = await db
    .prepare(
      `SELECT ${QUESTION_COLS}
       FROM edition_questions WHERE id = ? AND hackathonId = ?`,
    )
    .get<QuestionRow>(questionId, hackathonId);
  return row ? toQuestion(row) : null;
}

export async function hasActiveQuestions(
  hackathonId: string,
  audience: Audience = "participante",
): Promise<boolean> {
  const row = await db
    .prepare(
      "SELECT COUNT(*) AS n FROM edition_questions WHERE hackathonId = ? AND audience = ? AND archived = 0",
    )
    .get<{ n: number }>(hackathonId, audience);
  return (row?.n ?? 0) > 0;
}

export async function createQuestion(
  hackathonId: string,
  input: { kind: QuestionKind; label: string; options?: string[]; required?: boolean; audience?: Audience },
): Promise<EditionQuestion> {
  const v = validateQuestionInput(input);
  if (!v.ok) throw new Error(v.error);
  const q = v.value;
  const audience = input.audience ?? "participante";
  if (!isAudience(audience)) throw new Error("público inválido");
  return db.transaction(async () => {
    const pos = await db
      .prepare(
        "SELECT COALESCE(MAX(position), 0) + 1 AS p FROM edition_questions WHERE hackathonId = ? AND audience = ?",
      )
      .get<{ p: number }>(hackathonId, audience);
    const row = await db
      .prepare(
        `INSERT INTO edition_questions (hackathonId, audience, kind, label, options, required, position)
         VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      )
      .get<{ id: number }>(
        hackathonId,
        audience,
        q.kind,
        q.label,
        JSON.stringify(q.options),
        q.required ? 1 : 0,
        pos?.p ?? 1,
      );
    await db
      .prepare(
        `INSERT INTO edition_question_versions (questionId, version, kind, label, options, required)
         VALUES (?, 1, ?, ?, ?, ?)`,
      )
      .run(row!.id, q.kind, q.label, JSON.stringify(q.options), q.required ? 1 : 0);
    return (await getQuestion(hackathonId, row!.id))!;
  })();
}

/**
 * Edita a pergunta. Mudança de texto/tipo/opções numa pergunta que já tem
 * resposta na versão atual sobe a version (a antiga fica congelada pra quem
 * respondeu). Sem resposta, edita no lugar. Obrigatoriedade não versiona.
 * null = a pergunta não é dessa edição.
 */
export async function updateQuestion(
  hackathonId: string,
  questionId: number,
  patch: { kind?: QuestionKind; label?: string; options?: string[]; required?: boolean },
): Promise<EditionQuestion | null> {
  return db.transaction(async () => {
    const cur = await getQuestion(hackathonId, questionId);
    if (!cur) return null;
    const v = validateQuestionInput({
      kind: patch.kind ?? cur.kind,
      label: patch.label ?? cur.label,
      options: patch.options ?? cur.options,
      required: patch.required ?? cur.required,
    });
    if (!v.ok) throw new Error(v.error);
    const next = v.value;
    const contentChanged =
      next.kind !== cur.kind ||
      next.label !== cur.label ||
      JSON.stringify(next.options) !== JSON.stringify(cur.options);
    // resposta de inscrição OU de candidatura congela a versão
    const answered = await db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM registration_answers WHERE questionId = ? AND questionVersion = ?)
              + (SELECT COUNT(*) FROM role_application_answers WHERE questionId = ? AND questionVersion = ?) AS n`,
      )
      .get<{ n: number }>(questionId, cur.version, questionId, cur.version);
    const version = contentChanged && (answered?.n ?? 0) > 0 ? cur.version + 1 : cur.version;
    const opts = JSON.stringify(next.options);
    const req = next.required ? 1 : 0;
    await db
      .prepare(
        `UPDATE edition_questions
         SET kind = ?, label = ?, options = ?, required = ?, version = ?, updatedAt = datetime('now')
         WHERE id = ?`,
      )
      .run(next.kind, next.label, opts, req, version, questionId);
    if (version !== cur.version) {
      await db
        .prepare(
          `INSERT INTO edition_question_versions (questionId, version, kind, label, options, required)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(questionId, version, next.kind, next.label, opts, req);
    } else {
      await db
        .prepare(
          `UPDATE edition_question_versions SET kind = ?, label = ?, options = ?, required = ?
           WHERE questionId = ? AND version = ?`,
        )
        .run(next.kind, next.label, opts, req, questionId, version);
    }
    return getQuestion(hackathonId, questionId);
  })();
}

/** respostas por pergunta na versão ATUAL (as que uma edição congelaria) */
export async function countCurrentAnswers(
  hackathonId: string,
  audience: Audience = "participante",
): Promise<Record<number, number>> {
  const rows = await db
    .prepare(
      `SELECT q.id, COUNT(*) AS n
       FROM edition_questions q
       JOIN (
         SELECT questionId, questionVersion FROM registration_answers
         UNION ALL
         SELECT questionId, questionVersion FROM role_application_answers
       ) a ON a.questionId = q.id AND a.questionVersion = q.version
       WHERE q.hackathonId = ? AND q.audience = ?
       GROUP BY q.id`,
    )
    .all<{ id: number; n: number }>(hackathonId, audience);
  return Object.fromEntries(rows.map((r) => [r.id, r.n]));
}

/** arquivar tira do formulário mas preserva respostas e coluna no CSV */
export async function setQuestionArchived(
  hackathonId: string,
  questionId: number,
  archived: boolean,
): Promise<EditionQuestion | null> {
  const r = await db
    .prepare(
      `UPDATE edition_questions SET archived = ?, updatedAt = datetime('now')
       WHERE id = ? AND hackathonId = ?`,
    )
    .run(archived ? 1 : 0, questionId, hackathonId);
  return r.changes > 0 ? getQuestion(hackathonId, questionId) : null;
}

/** troca de lugar com a vizinha ativa de cima/baixo; nas pontas é no-op */
export async function moveQuestion(
  hackathonId: string,
  questionId: number,
  dir: "up" | "down",
): Promise<boolean> {
  return db.transaction(async () => {
    const q = await getQuestion(hackathonId, questionId);
    if (!q) return false;
    const list = await listQuestions(hackathonId, { audience: q.audience });
    const i = list.findIndex((x) => x.id === questionId);
    const j = dir === "up" ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= list.length) return false;
    // renumera 1..n na nova ordem (posições antigas podem ter buracos/empates)
    const order = list.map((q) => q.id);
    [order[i], order[j]] = [order[j], order[i]];
    for (const [k, id] of order.entries()) {
      await db.prepare("UPDATE edition_questions SET position = ? WHERE id = ?").run(k + 1, id);
    }
    return true;
  })();
}

// ---------- respostas ----------

export type ValidAnswer = { questionId: number; version: number; value: string };

/**
 * Valida as respostas contra as perguntas ativas. Obrigatória vazia (ou
 * valor fora das opções) → erro com o id da pergunta. Pergunta desconhecida
 * é ignorada; opcional vazia não grava linha. multi vira JSON, yes_no vira "sim"/"não".
 */
export function validateAnswers(
  questions: EditionQuestion[],
  raw: unknown,
): { ok: true; answers: ValidAnswer[] } | { ok: false; error: string; questionId: number } {
  const bag = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const answers: ValidAnswer[] = [];
  for (const q of questions) {
    if (q.archived) continue;
    const v = bag[String(q.id)];
    const fail = (error: string) => ({ ok: false as const, error, questionId: q.id });
    let value: string | null = null;
    switch (q.kind) {
      case "short_text":
      case "long_text": {
        const s = typeof v === "string" ? v.trim() : "";
        const max = q.kind === "short_text" ? MAX_SHORT : MAX_LONG;
        if (s.length > max) return fail(`"${q.label}": até ${max} caracteres`);
        value = s || null;
        break;
      }
      case "single": {
        const s = typeof v === "string" ? v : "";
        if (s && !q.options.includes(s)) return fail(`"${q.label}": opção inválida`);
        value = s || null;
        break;
      }
      case "multi": {
        const arr = Array.isArray(v) ? v : v === undefined || v === null || v === "" ? [] : [v];
        if (arr.some((x) => typeof x !== "string" || !q.options.includes(x))) {
          return fail(`"${q.label}": opção inválida`);
        }
        const picked = [...new Set(arr as string[])];
        value = picked.length ? JSON.stringify(picked) : null;
        break;
      }
      case "yes_no": {
        if (v === true || v === "sim" || v === "yes") value = "sim";
        else if (v === false || v === "não" || v === "nao" || v === "no") value = "não";
        else if (v === undefined || v === null || v === "") value = null;
        else return fail(`"${q.label}": responda sim ou não`);
        break;
      }
    }
    if (value === null) {
      if (q.required) return fail(`"${q.label}" é obrigatória`);
      continue;
    }
    answers.push({ questionId: q.id, version: q.version, value });
  }
  return { ok: true, answers };
}

/** valor de exibição: multi (JSON) vira "a; b" */
export function displayAnswer(value: string): string {
  if (value.startsWith("[")) {
    const arr = parseOptions(value);
    if (arr.length) return arr.join("; ");
  }
  return value;
}

export type AnswerView = { questionId: number; questionVersion: number; label: string; value: string };

export async function getAnswersForRegistration(memberId: number, hackathonId: string): Promise<AnswerView[]> {
  return db
    .prepare(
      `SELECT a.questionId, a.questionVersion, v.label, a.value
       FROM registration_answers a
       JOIN registrations r ON r.id = a.registrationId
       JOIN edition_question_versions v ON v.questionId = a.questionId AND v.version = a.questionVersion
       JOIN edition_questions q ON q.id = a.questionId
       WHERE r.memberId = ? AND r.hackathonId = ?
       ORDER BY q.archived, q.position, q.id`,
    )
    .all<AnswerView>(memberId, hackathonId);
}

// ---------- consentimento ----------

const SCOPE_PURPOSE: Record<Audience, string> = {
  participante:
    "as respostas desta inscrição para organizar o evento: seleção, comunicação, credenciamento e certificados",
  voluntario:
    "as respostas desta candidatura a voluntário para avaliá-la e, se aprovada, organizar minha atuação na edição: escala, comunicação, credenciamento e certificado",
  mentor:
    "as respostas desta candidatura a mentor para avaliá-la e, se aprovada, organizar minha atuação na edição: agenda com os times, comunicação, credenciamento e certificado",
  jurado:
    "as respostas desta candidatura a jurado para avaliá-la e, se aprovada, organizar minha atuação na edição: atribuição de projetos, comunicação, credenciamento e certificado",
};

/**
 * finalidade exibida e gravada: organização + parceiros nomeados da edição.
 * scope = pra quê (inscrição de participante ou candidatura de um tipo) —
 * o aceite de um não vale pelo outro.
 */
export async function consentPurpose(
  hackathonId: string,
  scope: Audience = "participante",
): Promise<{
  organizer: string;
  partners: string[];
  text: string;
}> {
  const h = await db
    .prepare("SELECT organizer FROM hackathons WHERE id = ?")
    .get<{ organizer: string }>(hackathonId);
  const rows = await db
    .prepare(
      `SELECT DISTINCT COALESCE(s.name, c.sponsor) AS name
       FROM challenges c LEFT JOIN sponsors s ON s.id = c.sponsorId
       WHERE c.hackathonId = ? AND c.active = 1
       ORDER BY 1`,
    )
    .all<{ name: string }>(hackathonId);
  const organizer = h?.organizer ?? "a organização";
  const partners = rows.map((r) => r.name).filter(Boolean);
  const quem = partners.length
    ? `${organizer} e os parceiros desta edição (${partners.join(", ")})`
    : `${organizer}`;
  const text =
    `Autorizo ${quem} a tratar meus dados de perfil e ${SCOPE_PURPOSE[scope]}. ` +
    `Li os termos de uso e a política de privacidade (versão ${TERMS_VERSION}).`;
  return { organizer, partners, text };
}

export async function hasCurrentConsent(
  memberId: number,
  hackathonId: string,
  scope: Audience = "participante",
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS ok FROM consents
       WHERE memberId = ? AND hackathonId = ? AND termsVersion = ? AND scope = ? LIMIT 1`,
    )
    .get(memberId, hackathonId, TERMS_VERSION, scope);
  return Boolean(row);
}

// ---------- inscrição completa ----------

export type SubmitResult =
  | { ok: false; error: string; questionId?: number }
  | {
      ok: true;
      status: RegistrationStatus;
      created: boolean;
      position: number | null;
      reward?: { xp: string; cardSerial: number | null; newBadges: Badge[] };
    };

/**
 * Inscrição pelo formulário: valida obrigatórias, exige consentimento (a
 * menos que o membro já tenha aceitado a versão atual nesta edição) e grava
 * inscrição + consentimento + respostas numa transação só — erro em
 * qualquer passo não deixa nada pela metade. Quem já tem inscrição recebe o
 * status atual (idempotente, sem recompensa nem caixa de novo).
 */
export async function submitRegistration(input: {
  memberId: number;
  hackathonId: string;
  answers: unknown;
  consent: boolean;
  ip: string | null;
}): Promise<SubmitResult> {
  const { memberId, hackathonId } = input;
  const existing = await getRegistrationStatus(memberId, hackathonId);
  if (existing) {
    const r = await register(memberId, hackathonId);
    return { ok: true, status: r.status, created: false, position: r.position };
  }
  // frente E — quem se candidatou pra ajudar (pendente ou aprovado) não
  // compete na mesma edição; jurado (por candidatura ou convite) nunca.
  const helper = await db
    .prepare(
      `SELECT kind FROM role_applications
       WHERE memberId = ? AND hackathonId = ? AND status IN ('pending', 'approved')
       UNION ALL
       SELECT 'jurado' FROM edition_roles WHERE memberId = ? AND hackathonId = ? AND role = 'jurado'
       LIMIT 1`,
    )
    .get<{ kind: string }>(memberId, hackathonId, memberId, hackathonId);
  if (helper) return { ok: false, error: `conflict_role:${helper.kind}` };
  const questions = await listQuestions(hackathonId);
  const valid = validateAnswers(questions, input.answers);
  if (!valid.ok) return { ok: false, error: valid.error, questionId: valid.questionId };
  if (!input.consent && !(await hasCurrentConsent(memberId, hackathonId))) {
    return { ok: false, error: "consent_required" };
  }
  const purpose = input.consent ? (await consentPurpose(hackathonId)).text : null;

  return db.transaction(async (): Promise<SubmitResult> => {
    const reg = await register(memberId, hackathonId);
    if (!reg.created) return { ok: true, status: reg.status, created: false, position: reg.position };
    if (purpose) {
      await db
        .prepare(
          `INSERT INTO consents (memberId, hackathonId, termsVersion, purpose, ip)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(memberId, hackathonId, TERMS_VERSION, purpose, input.ip);
    }
    const regId = await db
      .prepare("SELECT id FROM registrations WHERE memberId = ? AND hackathonId = ?")
      .get<{ id: number }>(memberId, hackathonId);
    for (const a of valid.answers) {
      await db
        .prepare(
          `INSERT INTO registration_answers (registrationId, questionId, questionVersion, value)
           VALUES (?, ?, ?, ?)`,
        )
        .run(regId!.id, a.questionId, a.version, a.value);
    }
    const reward = reg.status === "approved" ? await completeRegistration(memberId, hackathonId) : undefined;
    return { ok: true, status: reg.status, created: true, position: reg.position, reward };
  })();
}

// ---------- admin: inscritos com respostas + CSV ----------

export type RegistrantWithAnswers = {
  memberId: number;
  username: string;
  name: string | null;
  email: string;
  github: string | null;
  status: RegistrationStatus;
  createdAt: string;
  waitlistPosition: number | null;
  promotedAt: string | null;
  consentVersion: string | null;
  consentAt: string | null;
  answers: Record<number, { value: string; label: string; questionVersion: number }>;
};

export async function listRegistrantsWithAnswers(hackathonId: string): Promise<RegistrantWithAnswers[]> {
  const rows = await db
    .prepare(
      `SELECT r.id AS registrationId, r.memberId, m.username, m.name, m.email, m.github,
              r.status, r.createdAt, r.promotedAt,
              CASE WHEN r.status = 'waitlist' THEN
                (SELECT COUNT(*) FROM registrations o
                 WHERE o.hackathonId = r.hackathonId AND o.status = 'waitlist'
                   AND (o.waitlistedAt < r.waitlistedAt
                        OR (o.waitlistedAt = r.waitlistedAt AND o.id <= r.id)))
              END AS waitlistPosition,
              c.termsVersion AS consentVersion, c.acceptedAt AS consentAt
       FROM registrations r
       JOIN members m ON m.id = r.memberId
       LEFT JOIN LATERAL (
         SELECT termsVersion, acceptedAt FROM consents
         WHERE memberId = r.memberId AND hackathonId = r.hackathonId AND scope = 'participante'
         ORDER BY id DESC LIMIT 1
       ) c ON true
       WHERE r.hackathonId = ?
       ORDER BY CASE r.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 WHEN 'waitlist' THEN 2 ELSE 3 END,
                CASE WHEN r.status = 'waitlist' THEN r.waitlistedAt END,
                r.createdAt, r.id`,
    )
    .all<Omit<RegistrantWithAnswers, "answers"> & { registrationId: number }>(hackathonId);
  const answers = await db
    .prepare(
      `SELECT a.registrationId, a.questionId, a.questionVersion, a.value, v.label
       FROM registration_answers a
       JOIN registrations r ON r.id = a.registrationId
       JOIN edition_question_versions v ON v.questionId = a.questionId AND v.version = a.questionVersion
       WHERE r.hackathonId = ?`,
    )
    .all<{ registrationId: number; questionId: number; questionVersion: number; value: string; label: string }>(
      hackathonId,
    );
  const byReg = new Map<number, RegistrantWithAnswers["answers"]>();
  for (const a of answers) {
    const bag = byReg.get(a.registrationId) ?? {};
    bag[a.questionId] = { value: a.value, label: a.label, questionVersion: a.questionVersion };
    byReg.set(a.registrationId, bag);
  }
  return rows.map(({ registrationId, ...r }) => ({ ...r, answers: byReg.get(registrationId) ?? {} }));
}

// RFC4180 + defesa contra injeção de fórmula (planilha executa =, +, -, @)
export function csvField(raw: string | number | null | undefined): string {
  let s = raw === null || raw === undefined ? "" : String(raw);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function registrantsCsv(questions: EditionQuestion[], rows: RegistrantWithAnswers[]): string {
  const fixed = [
    "username",
    "nome",
    "email",
    "github",
    "status",
    "posicao_fila",
    "inscrito_em",
    "promovido_em",
    "termo_versao",
    "consentimento_em",
  ];
  const header = [
    ...fixed,
    ...questions.map((q) => (q.archived ? `${q.label} (arquivada)` : q.label)),
  ].map(csvField);
  const lines = rows.map((r) =>
    [
      r.username,
      r.name,
      r.email,
      r.github,
      r.status,
      r.waitlistPosition,
      r.createdAt,
      r.promotedAt,
      r.consentVersion,
      r.consentAt,
      ...questions.map((q) => {
        const a = r.answers[q.id];
        return a ? displayAnswer(a.value) : "";
      }),
    ]
      .map(csvField)
      .join(","),
  );
  return [header.join(","), ...lines].join("\n") + "\n";
}
