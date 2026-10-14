import db from "@/lib/db";
import type { Hackathon } from "@/lib/hackathons";
import type { EditionQuestion } from "@/lib/registrationForm";

// Carga horária do certificado (roadmap 037 #2, research 035 #3). A
// organização define horas por papel; sem valor, o participante fica com a
// duração da edição e os outros papéis precisam ser preenchidos. As horas são congeladas no certificado na emissão
// (lib/certificates) — aqui é só a configuração viva.

export const CERT_ROLES = ["participante", "staff", "mentor", "jurado", "organizador"] as const;
export type CertRole = (typeof CERT_ROLES)[number];

export const CERT_ROLE_LABEL: Record<CertRole, string> = {
  participante: "participante",
  staff: "voluntário(a) / staff",
  mentor: "mentor(a)",
  jurado: "jurado(a)",
  organizador: "organizador(a)",
};

export const HOURS_MIN = 1;
export const HOURS_MAX = 1000;
/** dia sem horário definido conta como um dia útil de evento */
export const HOURS_PER_DAY = 8;

const HOURS_COLUMN: Record<CertRole, string> = {
  participante: "hoursParticipante",
  staff: "hoursStaff",
  mentor: "hoursMentor",
  jurado: "hoursJurado",
  organizador: "hoursOrganizador",
};

export type CertSettings = {
  hackathonId: string;
  /** override por papel; null = default da duração */
  hours: Record<CertRole, number | null>;
  requireLockedEntry: boolean;
  institution: string | null;
  courseQuestionId: number | null;
  institutionQuestionId: number | null;
  enrollmentQuestionId: number | null;
};

export class CertSettingsError extends Error {
  status = 400;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function parseWhen(v: string): Date | null {
  const s = v.trim();
  const iso = DATE_ONLY.test(s)
    ? `${s}T00:00:00Z`
    : /[zZ]|[+-]\d{2}:?\d{2}$/.test(s)
      ? s.replace(" ", "T")
      : `${s.replace(" ", "T")}Z`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Default de carga horária = duração da edição. Com horário de início e fim:
 * horas corridas arredondadas (mín. 1). Só com data: 8h por dia de evento
 * (inclusivo). Sem fim: um dia (8h) ou, com hora de início, 8h.
 */
export function defaultEditionHours(startsAt: string, endsAt: string | null): number {
  const start = parseWhen(startsAt);
  if (!start) return HOURS_PER_DAY;
  const end = endsAt ? parseWhen(endsAt) : null;
  if (!end || end.getTime() <= start.getTime()) return HOURS_PER_DAY;
  const dateOnly = DATE_ONLY.test(startsAt.trim()) || DATE_ONLY.test((endsAt ?? "").trim());
  if (dateOnly) {
    const days = Math.round((Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()) -
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())) / 86_400_000) + 1;
    return Math.min(HOURS_MAX, Math.max(1, days) * HOURS_PER_DAY);
  }
  return Math.min(HOURS_MAX, Math.max(1, Math.round((end.getTime() - start.getTime()) / 3_600_000)));
}

/**
 * horas efetivas de um papel. Só o participante herda a duração da edição
 * quando a organização não preenche: a duração corrida inclui madrugada e
 * não diz quanto tempo o mentor ou o jurado ficou. Os outros papéis voltam
 * null = precisam ser preenchidos antes de emitir.
 */
export function hoursFor(
  settings: Pick<CertSettings, "hours">,
  h: Pick<Hackathon, "startsAt" | "endsAt">,
  role: CertRole,
): number | null {
  const set = settings.hours[role];
  if (set !== null) return set;
  return role === "participante" ? defaultEditionHours(h.startsAt, h.endsAt) : null;
}

/** papéis que pedem horas preenchidas (não herdam a duração) */
export const ROLES_REQUIRING_HOURS: CertRole[] = CERT_ROLES.filter((r) => r !== "participante");

const emptyHours = (): Record<CertRole, number | null> => ({
  participante: null,
  staff: null,
  mentor: null,
  jurado: null,
  organizador: null,
});

type SettingsRow = {
  hoursParticipante: number | null;
  hoursStaff: number | null;
  hoursMentor: number | null;
  hoursJurado: number | null;
  hoursOrganizador: number | null;
  requireLockedEntry: number;
  institution: string | null;
  courseQuestionId: number | null;
  institutionQuestionId: number | null;
  enrollmentQuestionId: number | null;
};

export async function getCertSettings(hackathonId: string): Promise<CertSettings> {
  const r = await db
    .prepare(
      `SELECT hoursParticipante, hoursStaff, hoursMentor, hoursJurado, hoursOrganizador,
              requireLockedEntry, institution, courseQuestionId, institutionQuestionId, enrollmentQuestionId
       FROM certificate_settings WHERE hackathonId = ?`,
    )
    .get<SettingsRow>(hackathonId);
  if (!r) {
    return {
      hackathonId,
      hours: emptyHours(),
      requireLockedEntry: false,
      institution: null,
      courseQuestionId: null,
      institutionQuestionId: null,
      enrollmentQuestionId: null,
    };
  }
  return {
    hackathonId,
    hours: {
      participante: r.hoursParticipante,
      staff: r.hoursStaff,
      mentor: r.hoursMentor,
      jurado: r.hoursJurado,
      organizador: r.hoursOrganizador,
    },
    requireLockedEntry: r.requireLockedEntry === 1,
    institution: r.institution,
    courseQuestionId: r.courseQuestionId,
    institutionQuestionId: r.institutionQuestionId,
    enrollmentQuestionId: r.enrollmentQuestionId,
  };
}

function validHours(v: unknown, role: CertRole): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < HOURS_MIN || n > HOURS_MAX) {
    throw new CertSettingsError(`horas de ${CERT_ROLE_LABEL[role]} precisam ser inteiras de ${HOURS_MIN} a ${HOURS_MAX}`);
  }
  return n;
}

async function validQuestion(hackathonId: string, v: unknown): Promise<number | null> {
  if (v === null || v === undefined || v === "") return null;
  const id = Number(v);
  const ok =
    Number.isInteger(id) &&
    (await db
      .prepare("SELECT 1 FROM edition_questions WHERE id = ? AND hackathonId = ? AND audience = 'participante'")
      .get(id, hackathonId));
  if (!ok) throw new CertSettingsError("pergunta do formulário não encontrada nesta edição");
  return id;
}

export type CertSettingsPatch = Partial<{
  hours: Partial<Record<CertRole, unknown>>;
  requireLockedEntry: unknown;
  institution: unknown;
  courseQuestionId: unknown;
  institutionQuestionId: unknown;
  enrollmentQuestionId: unknown;
}>;

/** grava a configuração (campo ausente = mantém); devolve o estado novo */
export async function updateCertSettings(hackathonId: string, patch: CertSettingsPatch): Promise<CertSettings> {
  const cur = await getCertSettings(hackathonId);
  const hours = { ...cur.hours };
  if (patch.hours && typeof patch.hours === "object") {
    for (const role of CERT_ROLES) {
      if (role in patch.hours) hours[role] = validHours(patch.hours[role], role);
    }
  }
  let institution = cur.institution;
  if (patch.institution !== undefined) {
    const s = typeof patch.institution === "string" ? patch.institution.trim() : "";
    if (s.length > 160) throw new CertSettingsError("nome da instituição longo demais (máx. 160)");
    institution = s || null;
  }
  const next: CertSettings = {
    hackathonId,
    hours,
    requireLockedEntry:
      patch.requireLockedEntry === undefined ? cur.requireLockedEntry : patch.requireLockedEntry === true,
    institution,
    courseQuestionId:
      patch.courseQuestionId === undefined ? cur.courseQuestionId : await validQuestion(hackathonId, patch.courseQuestionId),
    institutionQuestionId:
      patch.institutionQuestionId === undefined
        ? cur.institutionQuestionId
        : await validQuestion(hackathonId, patch.institutionQuestionId),
    enrollmentQuestionId:
      patch.enrollmentQuestionId === undefined
        ? cur.enrollmentQuestionId
        : await validQuestion(hackathonId, patch.enrollmentQuestionId),
  };
  const cols = CERT_ROLES.map((r) => HOURS_COLUMN[r]);
  await db
    .prepare(
      `INSERT INTO certificate_settings (hackathonId, ${cols.join(", ")}, requireLockedEntry, institution,
         courseQuestionId, institutionQuestionId, enrollmentQuestionId, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, sqlite_now())
       ON CONFLICT (hackathonId) DO UPDATE SET
         ${cols.map((c) => `${c} = EXCLUDED.${c}`).join(", ")},
         requireLockedEntry = EXCLUDED.requireLockedEntry, institution = EXCLUDED.institution,
         courseQuestionId = EXCLUDED.courseQuestionId, institutionQuestionId = EXCLUDED.institutionQuestionId,
         enrollmentQuestionId = EXCLUDED.enrollmentQuestionId, updatedAt = EXCLUDED.updatedAt`,
    )
    .run(
      hackathonId,
      ...CERT_ROLES.map((r) => next.hours[r]),
      next.requireLockedEntry ? 1 : 0,
      next.institution,
      next.courseQuestionId,
      next.institutionQuestionId,
      next.enrollmentQuestionId,
    );
  return next;
}

// ---------- mapeamento pergunta → curso/instituição/matrícula ----------

export type QuestionMapping = {
  course: number | null;
  institution: number | null;
  enrollment: number | null;
};

const MATCHERS: [keyof QuestionMapping, RegExp][] = [
  ["enrollment", /matr[íi]cula|\bra\b|registro acad/i],
  ["course", /\bcurso\b|gradua[çc][ãa]o em/i],
  ["institution", /institui[çc][ãa]o|faculdade|universidade|escola|\bies\b/i],
];

/**
 * Qual pergunta do formulário é curso/instituição/matrícula. O que a
 * organização apontou vale; o resto é achado pelo texto da pergunta (a
 * primeira que casar, ativas antes das arquivadas). Uma pergunta não serve
 * pra dois campos.
 */
export function resolveQuestionMapping(
  questions: Pick<EditionQuestion, "id" | "label" | "archived">[],
  explicit: Pick<CertSettings, "courseQuestionId" | "institutionQuestionId" | "enrollmentQuestionId">,
): QuestionMapping {
  const out: QuestionMapping = {
    course: explicit.courseQuestionId,
    institution: explicit.institutionQuestionId,
    enrollment: explicit.enrollmentQuestionId,
  };
  const used = new Set(Object.values(out).filter((v): v is number => v !== null));
  const ordered = [...questions].sort((a, b) => Number(a.archived) - Number(b.archived));
  for (const [field, re] of MATCHERS) {
    if (out[field] !== null) continue;
    const hit = ordered.find((q) => !used.has(q.id) && re.test(q.label));
    if (hit) {
      out[field] = hit.id;
      used.add(hit.id);
    }
  }
  return out;
}
