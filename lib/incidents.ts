import db from "@/lib/db";
import { notify } from "@/lib/notifications";
import { canManageEdition } from "@/lib/roles";

// Canal de incidentes (roadmap 037 #7, pesquisa 035 item 9). Denúncia
// logada ou anônima; fila privada da edição que SÓ o organizador (e admin
// global) vê — staff não, a menos que o organizador marque a pessoa como
// responsável de conduta. Anônima nunca grava memberId nem IP (o freio de
// abuso é o rate-limit em memória da rota). Quem pede exclusão da conta
// tem o autor anonimizado (lib/privacy), mas a denúncia fica.

export const INCIDENT_KINDS = ["assedio", "discriminacao", "seguranca", "saude", "outro"] as const;
export type IncidentKind = (typeof INCIDENT_KINDS)[number];
export const INCIDENT_KIND_LABEL: Record<IncidentKind, string> = {
  assedio: "assédio",
  discriminacao: "discriminação ou ofensa",
  seguranca: "segurança (ameaça, furto, risco físico)",
  saude: "saúde ou bem-estar",
  outro: "outro",
};

export const INCIDENT_STATUSES = ["aberto", "em_andamento", "resolvido"] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];
export const INCIDENT_STATUS_LABEL: Record<IncidentStatus, string> = {
  aberto: "aberto",
  em_andamento: "em andamento",
  resolvido: "resolvido",
};

const MAX_DESCRIPTION = 4000;
const MIN_DESCRIPTION = 10;

export type IncidentInput = {
  kind: IncidentKind;
  description: string;
  location: string | null;
  occurredAt: string | null;
  contact: string | null;
  anonymous: boolean;
};

const short = (v: unknown, max: number) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? s.slice(0, max) : null;
};

export function validateIncident(raw: unknown): { ok: true; value: IncidentInput } | { ok: false; error: string } {
  const b = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!b) return { ok: false, error: "corpo inválido" };
  if (typeof b.kind !== "string" || !(INCIDENT_KINDS as readonly string[]).includes(b.kind)) {
    return { ok: false, error: "escolha o tipo do incidente" };
  }
  const description = typeof b.description === "string" ? b.description.trim() : "";
  if (description.length < MIN_DESCRIPTION) return { ok: false, error: "descreva o que aconteceu (pelo menos 10 caracteres)" };
  if (description.length > MAX_DESCRIPTION) return { ok: false, error: `descrição com até ${MAX_DESCRIPTION} caracteres` };
  return {
    ok: true,
    value: {
      kind: b.kind as IncidentKind,
      description,
      location: short(b.location, 200),
      occurredAt: short(b.occurredAt, 100),
      contact: short(b.contact, 200),
      anonymous: b.anonymous === true,
    },
  };
}

/** quem trata incidentes da edição: organizadores + responsáveis de conduta (ou admins, sem organizador) */
async function incidentRecipients(hackathonId: string): Promise<number[]> {
  const rows = await db
    .prepare(
      `SELECT memberId FROM edition_roles WHERE hackathonId = ? AND role = 'organizador'
       UNION
       SELECT memberId FROM edition_conduct_handlers WHERE hackathonId = ?`,
    )
    .all<{ memberId: number }>(hackathonId, hackathonId);
  if (rows.length) return rows.map((r) => r.memberId);
  const admins = await db.prepare("SELECT id FROM members WHERE role = 'admin'").all<{ id: number }>();
  return admins.map((a) => a.id);
}

/**
 * Registra a denúncia. reporterId só quando a pessoa está logada E não
 * pediu anonimato. Notifica os responsáveis in-app (sem detalhe no texto).
 */
export async function createIncident(
  hackathonId: string,
  input: IncidentInput,
  reporterId: number | null,
): Promise<{ id: number }> {
  const who = input.anonymous ? null : reporterId;
  const row = await db
    .prepare(
      `INSERT INTO incidents (hackathonId, reporterId, kind, description, location, occurredAt, contact)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    .get<{ id: number }>(hackathonId, who, input.kind, input.description, input.location, input.occurredAt, input.contact);
  const h = await db.prepare("SELECT name FROM hackathons WHERE id = ?").get<{ name: string }>(hackathonId);
  const recipients = await incidentRecipients(hackathonId);
  await Promise.all(
    recipients.map((m) =>
      notify(m, {
        type: "incident",
        text: `Nova denúncia de conduta em ${h?.name ?? hackathonId} — trate no painel`,
        href: `/admin/h/${hackathonId}/incidentes`,
      }),
    ),
  );
  return { id: row!.id };
}

export type Incident = {
  id: number;
  kind: IncidentKind;
  description: string;
  location: string | null;
  occurredAt: string | null;
  contact: string | null;
  anonymous: boolean;
  reporterUsername: string | null;
  status: IncidentStatus;
  internalNote: string | null;
  updatedByUsername: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function listIncidents(hackathonId: string): Promise<Incident[]> {
  const rows = await db
    .prepare(
      `SELECT i.id, i.kind, i.description, i.location, i.occurredAt, i.contact, i.status, i.internalNote,
              i.createdAt, i.updatedAt, r.username AS reporterUsername, u.username AS updatedByUsername,
              (i.reporterId IS NULL) AS anonymous
       FROM incidents i
       LEFT JOIN members r ON r.id = i.reporterId
       LEFT JOIN members u ON u.id = i.updatedBy
       WHERE i.hackathonId = ?
       ORDER BY CASE i.status WHEN 'aberto' THEN 0 WHEN 'em_andamento' THEN 1 ELSE 2 END, i.id DESC`,
    )
    .all<Incident>(hackathonId);
  return rows.map((r) => ({ ...r, anonymous: Boolean(r.anonymous) }));
}

export function validateIncidentPatch(
  raw: unknown,
): { ok: true; value: { status?: IncidentStatus; internalNote?: string | null } } | { ok: false; error: string } {
  const b = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!b) return { ok: false, error: "corpo inválido" };
  const out: { status?: IncidentStatus; internalNote?: string | null } = {};
  if (b.status !== undefined) {
    if (typeof b.status !== "string" || !(INCIDENT_STATUSES as readonly string[]).includes(b.status)) {
      return { ok: false, error: "status inválido" };
    }
    out.status = b.status as IncidentStatus;
  }
  if (b.internalNote !== undefined) {
    if (b.internalNote !== null && typeof b.internalNote !== "string") return { ok: false, error: "nota inválida" };
    const n = typeof b.internalNote === "string" ? b.internalNote.trim() : "";
    if (n.length > 4000) return { ok: false, error: "nota com até 4000 caracteres" };
    out.internalNote = n || null;
  }
  if (Object.keys(out).length === 0) return { ok: false, error: "nada pra salvar" };
  return { ok: true, value: out };
}

export async function updateIncident(
  hackathonId: string,
  incidentId: number,
  patch: { status?: IncidentStatus; internalNote?: string | null },
  actorId: number,
): Promise<boolean> {
  const r = await db
    .prepare(
      `UPDATE incidents SET
         status = COALESCE(?::text, status),
         internalNote = CASE WHEN ?::int = 1 THEN ?::text ELSE internalNote END,
         updatedBy = ?, updatedAt = datetime('now')
       WHERE id = ? AND hackathonId = ?`,
    )
    .run(
      patch.status ?? null,
      patch.internalNote !== undefined ? 1 : 0,
      patch.internalNote ?? null,
      actorId,
      incidentId,
      hackathonId,
    );
  return r.changes > 0;
}

// ---------- quem vê ----------

export async function isConductHandler(memberId: number, hackathonId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 AS x FROM edition_conduct_handlers WHERE hackathonId = ? AND memberId = ?")
    .get(hackathonId, memberId);
  return Boolean(row);
}

/** organizador/admin ou responsável de conduta marcado pelo organizador */
export async function canHandleIncidents(actor: { id: number; role: string } | null, hackathonId: string) {
  if (!actor) return false;
  if (await canManageEdition(actor, hackathonId)) return true;
  return isConductHandler(actor.id, hackathonId);
}

export type HandlerCandidate = { memberId: number; username: string; name: string | null; roles: string; handler: boolean };

/** gente da equipe da edição (fora organizador) com a marca de responsável */
export async function listHandlerCandidates(hackathonId: string): Promise<HandlerCandidate[]> {
  const rows = await db
    .prepare(
      `SELECT m.id AS memberId, m.username, m.name, string_agg(er.role, ', ' ORDER BY er.role) AS roles,
              EXISTS (SELECT 1 FROM edition_conduct_handlers h WHERE h.hackathonId = ? AND h.memberId = m.id) AS handler
       FROM edition_roles er JOIN members m ON m.id = er.memberId
       WHERE er.hackathonId = ?
       GROUP BY m.id, m.username, m.name
       HAVING NOT bool_or(er.role = 'organizador')
       ORDER BY m.username`,
    )
    .all<HandlerCandidate>(hackathonId, hackathonId);
  return rows.map((r) => ({ ...r, handler: Boolean(r.handler) }));
}

/** marca/desmarca responsável de conduta; só quem já é da equipe da edição */
export async function setConductHandler(
  hackathonId: string,
  memberId: number,
  on: boolean,
  grantedBy: number,
): Promise<boolean> {
  if (!on) {
    await db
      .prepare("DELETE FROM edition_conduct_handlers WHERE hackathonId = ? AND memberId = ?")
      .run(hackathonId, memberId);
    return true;
  }
  const team = await db
    .prepare("SELECT 1 AS x FROM edition_roles WHERE hackathonId = ? AND memberId = ? LIMIT 1")
    .get(hackathonId, memberId);
  if (!team) return false;
  await db
    .prepare(
      `INSERT INTO edition_conduct_handlers (hackathonId, memberId, grantedBy) VALUES (?, ?, ?)
       ON CONFLICT DO NOTHING`,
    )
    .run(hackathonId, memberId, grantedBy);
  return true;
}
