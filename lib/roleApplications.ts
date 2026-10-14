import db from "@/lib/db";
import { getHackathon, isOver } from "@/lib/hackathons";
import { notify } from "@/lib/notifications";
import {
  TERMS_VERSION,
  consentPurpose,
  hasCurrentConsent,
  listQuestions,
  validateAnswers,
} from "@/lib/registrationForm";
import { getEditionRoles, grantEditionRole, type EditionRole } from "@/lib/roles";
import {
  APPLICATION_KINDS,
  KIND_LABEL,
  KIND_ROLE,
  type ApplicationKind,
  type ApplicationStatus,
} from "@/lib/applicationKinds";

// Frente E (spec 033) — candidatura por tipo numa edição. Além de se
// inscrever como participante, a pessoa se candidata pra ajudar: voluntário,
// mentor ou jurado. O organizador abre os tipos que quiser, monta um
// formulário por tipo (edition_questions.audience) e decide; aprovar concede
// o papel da edição na hora.
//
// Regras de conflito (conservadoras, um lado da mesa por edição):
// - quem tem inscrição ativa de participante (aprovada, pendente ou na fila)
//   não se candidata a NENHUM tipo — jurado avaliaria o próprio time, mentor
//   favoreceria o próprio time, voluntário (staff) faria o próprio check-in;
// - quem tem candidatura pendente ou aprovada não se inscreve como
//   participante (lib/registrationForm.submitRegistration);
// - candidatura recusada não bloqueia nada e não reabre (decisão é final);
// - a pessoa pode se candidatar a mais de um tipo; o organizador decide.

export {
  APPLICATION_KINDS,
  KIND_LABEL,
  KIND_PITCH,
  KIND_ROLE,
  isApplicationKind,
  type ApplicationKind,
  type ApplicationStatus,
} from "@/lib/applicationKinds";

// ---------- tipos abertos ----------

export async function getOpenKinds(hackathonId: string): Promise<ApplicationKind[]> {
  const rows = await db
    .prepare("SELECT kind FROM edition_open_kinds WHERE hackathonId = ?")
    .all<{ kind: ApplicationKind }>(hackathonId);
  const open = new Set(rows.map((r) => r.kind));
  return APPLICATION_KINDS.filter((k) => open.has(k));
}

export async function setKindOpen(
  hackathonId: string,
  kind: ApplicationKind,
  open: boolean,
  by: number | null,
): Promise<ApplicationKind[]> {
  if (open) {
    await db
      .prepare("INSERT OR IGNORE INTO edition_open_kinds (hackathonId, kind, openedBy) VALUES (?, ?, ?)")
      .run(hackathonId, kind, by);
  } else {
    await db.prepare("DELETE FROM edition_open_kinds WHERE hackathonId = ? AND kind = ?").run(hackathonId, kind);
  }
  return getOpenKinds(hackathonId);
}

// ---------- candidatar ----------

export type ApplyError =
  | "edition_not_found"
  | "edition_over"
  | "kind_closed"
  | "conflict_participant"
  | "already_has_role"
  | "duplicate"
  | "consent_required"
  | "invalid_answer";

export type ApplyResult =
  | { ok: true; id: number; status: "pending" }
  | { ok: false; error: ApplyError; message?: string; questionId?: number; status?: ApplicationStatus };

/** status da inscrição de participante que bloqueia candidatura */
async function activeRegistration(memberId: number, hackathonId: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT 1 AS ok FROM registrations
       WHERE memberId = ? AND hackathonId = ? AND status IN ('approved', 'pending', 'waitlist')`,
    )
    .get(memberId, hackathonId);
  return Boolean(row);
}

export async function getMyApplications(
  memberId: number,
  hackathonId: string,
): Promise<Partial<Record<ApplicationKind, ApplicationStatus>>> {
  const rows = await db
    .prepare("SELECT kind, status FROM role_applications WHERE memberId = ? AND hackathonId = ?")
    .all<{ kind: ApplicationKind; status: ApplicationStatus }>(memberId, hackathonId);
  return Object.fromEntries(rows.map((r) => [r.kind, r.status]));
}

/**
 * Candidatura: tipo aberto, sem conflito com inscrição de participante,
 * respostas válidas no formulário daquele tipo e consentimento com a
 * finalidade da candidatura (a menos que já aceito nesta versão). Grava
 * candidatura + consentimento + respostas numa transação só.
 */
export async function applyForRole(input: {
  memberId: number;
  hackathonId: string;
  kind: ApplicationKind;
  answers: unknown;
  consent: boolean;
  ip: string | null;
}): Promise<ApplyResult> {
  const { memberId, hackathonId, kind } = input;
  const h = await getHackathon(hackathonId);
  if (!h || !h.active) return { ok: false, error: "edition_not_found" };
  if (isOver(h)) return { ok: false, error: "edition_over" };
  if (!(await getOpenKinds(hackathonId)).includes(kind)) return { ok: false, error: "kind_closed" };

  const existing = await db
    .prepare("SELECT status FROM role_applications WHERE hackathonId = ? AND memberId = ? AND kind = ?")
    .get<{ status: ApplicationStatus }>(hackathonId, memberId, kind);
  if (existing) return { ok: false, error: "duplicate", status: existing.status };
  if (await activeRegistration(memberId, hackathonId)) return { ok: false, error: "conflict_participant" };
  const roles = await getEditionRoles(hackathonId, memberId);
  if (roles.includes("organizador") || roles.includes(KIND_ROLE[kind])) {
    return { ok: false, error: "already_has_role" };
  }

  const questions = await listQuestions(hackathonId, { audience: kind });
  const valid = validateAnswers(questions, input.answers);
  if (!valid.ok) return { ok: false, error: "invalid_answer", message: valid.error, questionId: valid.questionId };
  if (!input.consent && !(await hasCurrentConsent(memberId, hackathonId, kind))) {
    return { ok: false, error: "consent_required" };
  }
  const purpose = input.consent ? (await consentPurpose(hackathonId, kind)).text : null;

  return db.transaction(async (): Promise<ApplyResult> => {
    const row = await db
      .prepare(
        `INSERT OR IGNORE INTO role_applications (hackathonId, memberId, kind)
         VALUES (?, ?, ?) RETURNING id`,
      )
      .get<{ id: number }>(hackathonId, memberId, kind);
    // corrida: outra requisição criou no meio do caminho
    if (!row) return { ok: false, error: "duplicate", status: "pending" };
    if (purpose) {
      await db
        .prepare(
          `INSERT INTO consents (memberId, hackathonId, termsVersion, purpose, ip, scope)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(memberId, hackathonId, TERMS_VERSION, purpose, input.ip, kind);
    }
    for (const a of valid.answers) {
      await db
        .prepare(
          `INSERT INTO role_application_answers (applicationId, questionId, questionVersion, value)
           VALUES (?, ?, ?, ?)`,
        )
        .run(row.id, a.questionId, a.version, a.value);
    }
    return { ok: true, id: row.id, status: "pending" };
  })();
}

/** retirar candidatura pendente (libera a inscrição de participante). Decidida não sai. */
export async function withdrawApplication(
  memberId: number,
  hackathonId: string,
  kind: ApplicationKind,
): Promise<"withdrawn" | "not_found" | "already_reviewed"> {
  const gone = await db
    .prepare(
      `DELETE FROM role_applications
       WHERE memberId = ? AND hackathonId = ? AND kind = ? AND status = 'pending' RETURNING id`,
    )
    .get(memberId, hackathonId, kind);
  if (gone) return "withdrawn";
  const left = await db
    .prepare("SELECT 1 AS ok FROM role_applications WHERE memberId = ? AND hackathonId = ? AND kind = ?")
    .get(memberId, hackathonId, kind);
  return left ? "already_reviewed" : "not_found";
}

// ---------- organizador ----------

export type ApplicationView = {
  id: number;
  memberId: number;
  username: string;
  name: string | null;
  email: string;
  kind: ApplicationKind;
  status: ApplicationStatus;
  note: string | null;
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  answers: { questionId: number; questionVersion: number; label: string; value: string }[];
};

/** fila do organizador: pendentes primeiro, depois por ordem de chegada */
export async function listApplications(hackathonId: string, kind?: ApplicationKind): Promise<ApplicationView[]> {
  const rows = await db
    .prepare(
      `SELECT a.id, a.memberId, m.username, m.name, m.email, a.kind, a.status, a.note,
              a.createdAt, a.reviewedAt, rv.username AS reviewedBy
       FROM role_applications a
       JOIN members m ON m.id = a.memberId
       LEFT JOIN members rv ON rv.id = a.reviewedBy
       WHERE a.hackathonId = ? AND (?::text IS NULL OR a.kind = ?::text)
       ORDER BY CASE a.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END, a.createdAt, a.id`,
    )
    .all<Omit<ApplicationView, "answers">>(hackathonId, kind ?? null, kind ?? null);
  const answers = await db
    .prepare(
      `SELECT ans.applicationId, ans.questionId, ans.questionVersion, v.label, ans.value
       FROM role_application_answers ans
       JOIN role_applications a ON a.id = ans.applicationId
       JOIN edition_question_versions v ON v.questionId = ans.questionId AND v.version = ans.questionVersion
       JOIN edition_questions q ON q.id = ans.questionId
       WHERE a.hackathonId = ?
       ORDER BY q.archived, q.position, q.id`,
    )
    .all<{ applicationId: number; questionId: number; questionVersion: number; label: string; value: string }>(
      hackathonId,
    );
  const byApp = new Map<number, ApplicationView["answers"]>();
  for (const { applicationId, ...a } of answers) {
    const list = byApp.get(applicationId) ?? [];
    list.push(a);
    byApp.set(applicationId, list);
  }
  return rows.map((r) => ({ ...r, answers: byApp.get(r.id) ?? [] }));
}

export type ReviewApplicationResult =
  | { ok: true; status: "approved"; role: EditionRole }
  | { ok: true; status: "rejected" }
  | { ok: false; error: "not_found" | "already_reviewed" | "conflict_participant" };

/**
 * Decide uma candidatura pendente. approve concede o papel da edição
 * (voluntario→staff, mentor→mentor, jurado→jurado) e avisa in-app; reject
 * só marca 'rejected' (estado honesto, nenhum papel) e avisa. Candidatura
 * já decidida não muda: tirar papel é na aba equipe.
 */
export async function reviewApplication(input: {
  hackathonId: string;
  applicationId: number;
  action: "approve" | "reject";
  reviewerId: number | null;
  note?: string | null;
}): Promise<ReviewApplicationResult> {
  const { hackathonId, applicationId, action } = input;
  const note = input.note?.trim().slice(0, 500) || null;
  type Decided = ReviewApplicationResult & { memberId?: number; kind?: ApplicationKind };
  const result = await db.transaction(async (): Promise<Decided> => {
    const app = await db
      .prepare(
        `SELECT id, memberId, kind, status FROM role_applications
         WHERE id = ? AND hackathonId = ? FOR UPDATE`,
      )
      .get<{ id: number; memberId: number; kind: ApplicationKind; status: ApplicationStatus }>(
        applicationId,
        hackathonId,
      );
    if (!app) return { ok: false, error: "not_found" };
    if (app.status !== "pending") return { ok: false, error: "already_reviewed" };
    // corrida: se inscreveu como participante entre a candidatura e a decisão
    if (action === "approve" && (await activeRegistration(app.memberId, hackathonId))) {
      return { ok: false, error: "conflict_participant" };
    }
    await db
      .prepare(
        `UPDATE role_applications
         SET status = ?, note = ?, reviewedAt = datetime('now'), reviewedBy = ?
         WHERE id = ?`,
      )
      .run(action === "approve" ? "approved" : "rejected", note, input.reviewerId, app.id);
    if (action === "approve") {
      const role = KIND_ROLE[app.kind];
      await grantEditionRole(hackathonId, app.memberId, role, input.reviewerId);
      return { ok: true, status: "approved", role, memberId: app.memberId, kind: app.kind };
    }
    return { ok: true, status: "rejected", memberId: app.memberId, kind: app.kind };
  })();
  if (!result.ok || result.memberId === undefined || !result.kind) return result;
  const h = await getHackathon(hackathonId);
  const edition = h?.name ?? "a edição";
  const label = KIND_LABEL[result.kind];
  await notify(
    result.memberId,
    result.status === "approved"
      ? {
          type: "role_application_approved",
          text: `tua candidatura de ${label} em ${edition} foi aprovada — o painel da edição já está liberado`,
          href: `/admin/h/${hackathonId}`,
        }
      : {
          type: "role_application_rejected",
          text: `tua candidatura de ${label} em ${edition} não foi aprovada desta vez`,
          href: `/h/${hackathonId}`,
        },
  );
  return result.status === "approved"
    ? { ok: true, status: "approved", role: result.role }
    : { ok: true, status: "rejected" };
}
