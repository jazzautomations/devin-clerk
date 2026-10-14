import { randomBytes } from "node:crypto";
import db from "@/lib/db";
import { isPublished } from "@/lib/jury";
import { getHackathon, type Hackathon } from "@/lib/hackathons";
import { notify } from "@/lib/notifications";
import {
  CERT_ROLE_LABEL,
  CERT_ROLES,
  getCertSettings,
  hoursFor,
  resolveQuestionMapping,
  type CertRole,
  type CertSettings,
} from "@/lib/certHours";
import { csvField, displayAnswer, listQuestions } from "@/lib/registrationForm";

// Certificado verificável (spec 033 US6, FR-007). Emissão é idempotente por
// (membro, edição, tipo): reemitir não duplica nem troca o código.
// Auditoria 041 (pacote D): o texto de um certificado emitido nunca muda.
// Se o detalhe mudou (pódio republicado), nasce um código novo e o antigo
// fica revogado; premiação de quem saiu do pódio também é revogada. O link
// /c/<código> de um revogado continua abrindo e diz "revogado".
// spec 034 — premiação é por categoria de prêmio (prizeCategoryId): a mesma
// pessoa pode levar o geral e um desafio. Com categorias, só integrante
// PRESENTE (check-in) do time vencedor recebe; sem categorias vale o pódio
// antigo (teams.placement), pra todo o time. O código é curto, aleatório e
// não sequencial; /c/[code] é o link público de verificação.
//
// roadmap 037 #2 — carga horária: na emissão o certificado CONGELA papel,
// horas, período e instituição promotora. Reemitir só atualiza o detalhe
// (pódio republicado); mudar as horas da edição depois não reescreve quem
// já recebeu (o aluno pode ter lançado a hora complementar com aquele
// número). Premiação não carrega horas (é distinção, não atividade: as horas
// já estão no certificado de participação).

export const CERT_KINDS = ["participacao", "mentoria", "jurado", "organizacao", "premiacao"] as const;
export type CertKind = (typeof CERT_KINDS)[number];

export const CERT_KIND_LABEL: Record<CertKind, string> = {
  participacao: "participação",
  mentoria: "mentoria",
  jurado: "júri",
  organizacao: "organização",
  premiacao: "premiação",
};

// base32 de Crockford: sem I, L, O, U (não confunde com 1/0 nem vira palavrão)
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{10}$/;

/** 10 chars = 50 bits de aleatoriedade */
export function newCertificateCode(): string {
  const bytes = randomBytes(10);
  let out = "";
  for (const b of bytes) out += ALPHABET[b & 31];
  return out;
}

/**
 * Quem conta como presente pra certificado de participação.
 * Spec: "sem presença, sem certificado" — a presença vem do check-in (frente A).
 * Presença mínima configurável (certificate_settings.requireLockedEntry):
 * além do check-in, o time da pessoa na edição precisa ter entrega enviada
 * até a trava (edição sem prazo de entrega: projeto cadastrado).
 */
export async function attendeesForCertificates(
  hackathonId: string,
  settings?: Pick<CertSettings, "requireLockedEntry">,
): Promise<number[]> {
  const requireEntry = (settings ?? (await getCertSettings(hackathonId))).requireLockedEntry;
  const entryRule = requireEntry
    ? `AND EXISTS (
         SELECT 1 FROM team_members tm
         JOIN teams t ON t.id = tm.teamId AND t.hackathonId = r.hackathonId
         JOIN hackathons h ON h.id = t.hackathonId
         WHERE tm.username = m.username
           AND CASE WHEN h.submissionDeadline IS NULL
                    THEN EXISTS (SELECT 1 FROM team_projects tp WHERE tp.teamId = t.id)
                    ELSE EXISTS (SELECT 1 FROM project_submissions ps WHERE ps.teamId = t.id) END)`
    : "";
  const rows = await db
    .prepare(
      `SELECT r.memberId FROM registrations r
       JOIN members m ON m.id = r.memberId
       JOIN checkins c ON c.registrationId = r.id
       WHERE r.hackathonId = ? AND r.status = 'approved' ${entryRule}
       ORDER BY r.memberId`,
    )
    .all<{ memberId: number }>(hackathonId);
  return rows.map((r) => r.memberId);
}

type Grant = {
  memberId: number;
  kind: CertKind;
  detail: string | null;
  prizeCategoryId?: number | null;
  role: CertRole;
};

const PLACE = (n: number) => `${n}º lugar`;

async function grantsFor(hackathonId: string, settings: CertSettings): Promise<Grant[]> {
  const grants: Grant[] = (await attendeesForCertificates(hackathonId, settings)).map((memberId) => ({
    memberId,
    kind: "participacao",
    detail: null,
    role: "participante",
  }));

  const roles = await db
    .prepare("SELECT memberId, role FROM edition_roles WHERE hackathonId = ? ORDER BY memberId, role")
    .all<{ memberId: number; role: string }>(hackathonId);
  const byKind = new Map<string, string[]>();
  for (const r of roles) {
    const kind = r.role === "mentor" ? "mentoria" : r.role === "jurado" ? "jurado" : "organizacao";
    const key = `${r.memberId}:${kind}`;
    byKind.set(key, [...(byKind.get(key) ?? []), r.role]);
  }
  for (const [key, list] of byKind) {
    const [id, kind] = key.split(":");
    // organizador e staff dividem o certificado de organização; as horas
    // seguem o papel mais alto (organizador)
    const role: CertRole =
      kind === "mentoria" ? "mentor" : kind === "jurado" ? "jurado" : list.includes("organizador") ? "organizador" : "staff";
    grants.push({
      memberId: Number(id),
      kind: kind as CertKind,
      detail: kind === "organizacao" ? list.join(" e ") : null,
      role,
    });
  }

  // premiação só com resultado do júri publicado. Com categorias: um
  // certificado por categoria, só pra integrante presente do time vencedor
  const published = await isPublished(hackathonId);
  const categoryWinners = published
    ? await db
        .prepare(
          `SELECT m.id AS memberId, w.place, w.categoryId, pc.name AS category, t.name
           FROM prize_winners w
           JOIN prize_categories pc ON pc.id = w.categoryId
           JOIN teams t ON t.id = w.teamId
           JOIN team_members tm ON tm.teamId = t.id
           JOIN members m ON m.username = tm.username
           JOIN registrations r ON r.memberId = m.id AND r.hackathonId = pc.hackathonId AND r.status = 'approved'
           WHERE pc.hackathonId = ? AND EXISTS (SELECT 1 FROM checkins c WHERE c.registrationId = r.id)
           ORDER BY w.categoryId, m.id`,
        )
        .all<{ memberId: number; place: number; categoryId: number; category: string; name: string }>(hackathonId)
    : [];
  const hasCategories = !!(await db
    .prepare("SELECT 1 FROM prize_categories WHERE hackathonId = ? LIMIT 1")
    .get(hackathonId));
  for (const w of categoryWinners) {
    grants.push({
      memberId: w.memberId,
      kind: "premiacao",
      detail: `${PLACE(w.place)} em ${w.category} com o time ${w.name}`,
      prizeCategoryId: w.categoryId,
      role: "participante",
    });
  }
  // modo antigo (sem categorias): pódio vale pro integrante presente do
  // time, com a mesma regra do caminho com categorias (sem presença, sem
  // certificado)
  if (!hasCategories && published) {
    const winners = await db
      .prepare(
        `SELECT m.id AS memberId, t.placement, t.name FROM teams t
         JOIN team_members tm ON tm.teamId = t.id
         JOIN members m ON m.username = tm.username
         JOIN registrations r ON r.memberId = m.id AND r.hackathonId = t.hackathonId AND r.status = 'approved'
         WHERE t.hackathonId = ? AND t.placement BETWEEN 1 AND 3
           AND EXISTS (SELECT 1 FROM checkins c WHERE c.registrationId = r.id)`,
      )
      .all<{ memberId: number; placement: number; name: string }>(hackathonId);
    for (const w of winners) {
      grants.push({
        memberId: w.memberId,
        kind: "premiacao",
        detail: `${PLACE(w.placement)} com o time ${w.name}`,
        role: "participante",
      });
    }
  }
  return grants;
}

export class CertificateError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const grantKey = (memberId: number, kind: string, categoryId: number | null | undefined) =>
  `${memberId}:${kind}:${categoryId ?? 0}`;

const listLabels = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} e ${xs.at(-1)}`);

/**
 * Emite o que falta, troca o que mudou e revoga a premiação que saiu.
 * Devolve quantos certificados novos nasceram, quantos foram revogados e o
 * total vigente da edição. Cada código novo vira uma notificação pro dono.
 */
export async function issueCertificates(
  hackathonId: string,
): Promise<{ created: number; revoked: number; total: number }> {
  const [settings, h] = await Promise.all([getCertSettings(hackathonId), getHackathon(hackathonId)]);
  if (!h) throw new Error("edição não encontrada");
  const institution = settings.institution ?? h.organizer;
  const periodEnd = h.endsAt ?? h.startsAt;
  const issued: { code: string; memberId: number; kind: CertKind }[] = [];
  let revoked = 0;
  await db.transaction(async () => {
    const [grants, active] = await Promise.all([
      grantsFor(hackathonId, settings),
      db
        .prepare(
          `SELECT code, memberId, kind, prizeCategoryId, detail FROM certificates
           WHERE hackathonId = ? AND revokedAt IS NULL`,
        )
        .all<{ code: string; memberId: number; kind: CertKind; prizeCategoryId: number | null; detail: string | null }>(
          hackathonId,
        ),
    ]);
    const current = new Map(active.map((c) => [grantKey(c.memberId, c.kind, c.prizeCategoryId), c]));
    const wanted = new Map<string, Grant>();
    for (const g of grants) {
      const k = grantKey(g.memberId, g.kind, g.prizeCategoryId);
      if (!wanted.has(k)) wanted.set(k, g);
    }
    const toIssue = [...wanted.entries()].filter(([k, g]) => {
      const cur = current.get(k);
      return !cur || cur.detail !== g.detail;
    });

    // horas: só o participante herda a duração; os outros papéis precisam
    // estar preenchidos antes de emitir
    const missing = rolesWithoutHours(
      toIssue.map(([, g]) => g),
      settings,
      h,
    );
    if (missing.length) {
      throw new CertificateError(
        `Preencha as horas de ${listLabels(missing.map((r) => CERT_ROLE_LABEL[r]))} na configuração antes de emitir.`,
        409,
      );
    }

    const revoke = async (code: string) => {
      await db.prepare("UPDATE certificates SET revokedAt = sqlite_now() WHERE code = ?").run(code);
      revoked++;
    };
    for (const [k, g] of toIssue) {
      const old = current.get(k);
      if (old) await revoke(old.code);
      const hours = g.kind === "premiacao" ? null : hoursFor(settings, h, g.role);
      // colisão de código (50 bits) é improvável; ainda assim tenta de novo
      for (let attempt = 0; ; attempt++) {
        const code = newCertificateCode();
        const taken = await db.prepare("SELECT 1 FROM certificates WHERE code = ?").get(code);
        if (taken) {
          if (attempt > 5) throw new Error("não consegui gerar código de certificado");
          continue;
        }
        // papel, horas, período e instituição ficam congelados aqui
        await db
          .prepare(
            `INSERT INTO certificates (code, memberId, hackathonId, kind, detail, prizeCategoryId,
               role, hours, periodStart, periodEnd, institution)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            code,
            g.memberId,
            hackathonId,
            g.kind,
            g.detail,
            g.prizeCategoryId ?? null,
            g.role,
            hours,
            h.startsAt,
            periodEnd,
            institution,
          );
        issued.push({ code, memberId: g.memberId, kind: g.kind });
        break;
      }
    }
    // premiação de quem saiu do resultado (republicado sem o time)
    for (const c of active) {
      if (c.kind === "premiacao" && !wanted.has(grantKey(c.memberId, c.kind, c.prizeCategoryId))) await revoke(c.code);
    }
  })();
  for (const c of issued) {
    await notify(c.memberId, {
      type: "certificate",
      text: `Seu certificado de ${CERT_KIND_LABEL[c.kind]} em ${h.name} está disponível.`,
      href: `/c/${c.code}`,
    });
  }
  const total = await db
    .prepare("SELECT COUNT(*) AS n FROM certificates WHERE hackathonId = ? AND revokedAt IS NULL")
    .get<{ n: number }>(hackathonId);
  return { created: issued.length, revoked, total: Number(total?.n ?? 0) };
}

/** papéis que vão receber certificado e ainda estão sem horas (bloqueiam a emissão) */
export async function rolesMissingHours(hackathonId: string, settings: CertSettings): Promise<CertRole[]> {
  const h = await getHackathon(hackathonId);
  if (!h) return [];
  return rolesWithoutHours(await grantsFor(hackathonId, settings), settings, h);
}

/** papéis (na ordem de CERT_ROLES) que algum certificado vai pedir e estão sem horas */
function rolesWithoutHours(
  grants: Grant[],
  settings: CertSettings,
  h: Pick<Hackathon, "startsAt" | "endsAt">,
): CertRole[] {
  const need = new Set(grants.filter((g) => g.kind !== "premiacao").map((g) => g.role));
  return CERT_ROLES.filter((r) => need.has(r) && hoursFor(settings, h, r) === null);
}

export type Certificate = {
  code: string;
  memberId: number;
  memberName: string;
  username: string;
  hackathonId: string;
  hackathonName: string;
  startsAt: string;
  endsAt: string | null;
  location: string | null;
  kind: CertKind;
  detail: string | null;
  issuedAt: string;
  /** congelados na emissão; null em certificado emitido antes da carga horária */
  role: CertRole | null;
  hours: number | null;
  periodStart: string | null;
  periodEnd: string | null;
  /** instituição promotora (congelada); certificado antigo cai no organizador da edição */
  institution: string;
  /** revogado (pódio republicado ou texto trocado); null = vigente */
  revokedAt: string | null;
};

const SELECT_CERT = `
  SELECT c.code, c.memberId, COALESCE(NULLIF(m.name, ''), m.username) AS memberName, m.username,
         c.hackathonId, h.name AS hackathonName, h.startsAt, h.endsAt, h.location,
         c.kind, c.detail, c.issuedAt, c.role, c.hours, c.periodStart, c.periodEnd,
         COALESCE(c.institution, h.organizer) AS institution, c.revokedAt
  FROM certificates c
  JOIN members m ON m.id = c.memberId
  JOIN hackathons h ON h.id = c.hackathonId`;

export async function getCertificate(code: string): Promise<Certificate | null> {
  const normalized = String(code ?? "").trim().toUpperCase();
  if (!CODE_RE.test(normalized)) return null;
  return (await db.prepare(`${SELECT_CERT} WHERE c.code = ?`).get<Certificate>(normalized)) ?? null;
}

export async function listMemberCertificates(memberId: number): Promise<Certificate[]> {
  return db
    .prepare(`${SELECT_CERT} WHERE c.memberId = ? AND c.revokedAt IS NULL ORDER BY h.startsAt DESC, c.kind`)
    .all<Certificate>(memberId);
}

export async function listEditionCertificates(hackathonId: string): Promise<Certificate[]> {
  return db
    .prepare(`${SELECT_CERT} WHERE c.hackathonId = ? AND c.revokedAt IS NULL ORDER BY c.kind, memberName`)
    .all<Certificate>(hackathonId);
}

/** data do banco em pt-BR: "YYYY-MM-DD" é dia civil; com hora é UTC → horário de Brasília */
export function formatCertDate(value: string): string {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const iso = dateOnly ? `${value}T00:00:00Z` : /[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value.replace(" ", "T")}Z`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return value;
  return new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: dateOnly ? "UTC" : "America/Sao_Paulo",
  }).format(d);
}

/** período do certificado: congelado na emissão; certificado antigo cai nas datas da edição */
export function certPeriod(c: Pick<Certificate, "periodStart" | "periodEnd" | "startsAt" | "endsAt">): string {
  const start = c.periodStart ?? c.startsAt;
  const end = c.periodEnd ?? c.endsAt ?? start;
  const a = formatCertDate(start);
  const b = formatCertDate(end);
  return a === b ? a : `${a} a ${b}`;
}

export const formatHours = (n: number) => `${n} ${n === 1 ? "hora" : "horas"}`;

/** papel impresso; null em certificado antigo (sem papel congelado) */
export function certRoleLabel(c: Pick<Certificate, "role" | "kind">): string | null {
  if (!c.role) return null;
  return c.kind === "premiacao" ? "participante premiado(a)" : CERT_ROLE_LABEL[c.role];
}

// ---------- CSV de hora complementar ----------

export type HoursCsvRow = {
  memberName: string;
  username: string;
  email: string;
  institutionStudent: string;
  course: string;
  enrollment: string;
  role: string;
  kind: CertKind;
  hours: number | null;
  periodStart: string;
  periodEnd: string;
  institution: string;
  code: string;
};

export const HOURS_CSV_HEADER = [
  "instituicao_aluno",
  "curso",
  "matricula",
  "nome",
  "email",
  "username",
  "papel",
  "tipo",
  "carga_horaria",
  "periodo_inicio",
  "periodo_fim",
  "instituicao_promotora",
  "codigo",
  "verificacao",
];

const sortKey = (s: string) => s.trim().toLocaleLowerCase("pt-BR");

/**
 * CSV pros coordenadores lançarem hora complementar: uma linha por
 * certificado, ordenado por instituição do aluno → curso → nome (o
 * coordenador filtra o curso dele). Quem não respondeu vai pro fim.
 * Proteção contra injeção de fórmula vem do csvField.
 */
export function buildHoursCsv(rows: HoursCsvRow[], baseUrl: string): string {
  const sorted = [...rows].sort((a, b) => {
    for (const k of ["institutionStudent", "course", "memberName"] as const) {
      const x = sortKey(a[k]);
      const y = sortKey(b[k]);
      if (x === y) continue;
      if (!x) return 1;
      if (!y) return -1;
      return x.localeCompare(y, "pt-BR");
    }
    return a.kind.localeCompare(b.kind);
  });
  const lines = sorted.map((r) =>
    [
      r.institutionStudent,
      r.course,
      r.enrollment,
      r.memberName,
      r.email,
      r.username,
      r.role,
      CERT_KIND_LABEL[r.kind],
      r.hours,
      r.periodStart,
      r.periodEnd,
      r.institution,
      r.code,
      `${baseUrl}/c/${r.code}`,
    ]
      .map(csvField)
      .join(","),
  );
  return `${[HOURS_CSV_HEADER.map(csvField).join(","), ...lines].join("\r\n")}\r\n`;
}

/** "YYYY-MM-DD" do dia em Brasília (data com hora no banco é UTC) */
function brDay(v: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(v) ? v : `${v.replace(" ", "T")}Z`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return v;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);
}

/** linhas do CSV da edição: certificados emitidos + respostas mapeadas do formulário */
export async function hoursCsvRows(hackathonId: string): Promise<HoursCsvRow[]> {
  const [certs, settings, questions] = await Promise.all([
    listEditionCertificates(hackathonId),
    getCertSettings(hackathonId),
    listQuestions(hackathonId, { includeArchived: true }),
  ]);
  const map = resolveQuestionMapping(questions, settings);
  const wanted = [map.course, map.institution, map.enrollment].filter((v): v is number => v !== null);
  const [answers, emails] = await Promise.all([
    wanted.length
      ? db
          .prepare(
            `SELECT r.memberId, a.questionId, a.value
             FROM registration_answers a
             JOIN registrations r ON r.id = a.registrationId
             WHERE r.hackathonId = ? AND a.questionId = ANY(?::int[])`,
          )
          .all<{ memberId: number; questionId: number; value: string }>(hackathonId, wanted)
      : Promise.resolve([]),
    db
      .prepare(
        `SELECT DISTINCT m.id, m.email FROM certificates c JOIN members m ON m.id = c.memberId
         WHERE c.hackathonId = ? AND c.revokedAt IS NULL`,
      )
      .all<{ id: number; email: string }>(hackathonId),
  ]);
  const emailOf = new Map(emails.map((e) => [e.id, e.email]));
  const byKey = new Map(answers.map((a) => [`${a.memberId}:${a.questionId}`, a.value]));
  const answer = (memberId: number, q: number | null) => {
    const v = q === null ? undefined : byKey.get(`${memberId}:${q}`);
    return v === undefined ? "" : displayAnswer(v);
  };
  return certs.map((c) => ({
    memberName: c.memberName,
    username: c.username,
    email: emailOf.get(c.memberId) ?? "",
    institutionStudent: answer(c.memberId, map.institution),
    course: answer(c.memberId, map.course),
    enrollment: answer(c.memberId, map.enrollment),
    role: certRoleLabel(c) ?? CERT_KIND_LABEL[c.kind],
    kind: c.kind,
    hours: c.hours,
    periodStart: brDay(c.periodStart ?? c.startsAt),
    periodEnd: brDay(c.periodEnd ?? c.endsAt ?? c.startsAt),
    institution: c.institution,
    code: c.code,
  }));
}
