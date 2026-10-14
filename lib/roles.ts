import db from "@/lib/db";

// Papéis por edição (spec 033 US7). Admin global (members.role = 'admin')
// pode tudo em qualquer edição; organizador da edição pode tudo nela,
// inclusive dar papéis; staff faz check-in; mentor responde dúvidas;
// jurado avalia os projetos atribuídos.

export const EDITION_ROLES = ["organizador", "staff", "mentor", "jurado"] as const;
export type EditionRole = (typeof EDITION_ROLES)[number];

type Actor = { id: number; role: string };

export function isEditionRole(v: unknown): v is EditionRole {
  return typeof v === "string" && (EDITION_ROLES as readonly string[]).includes(v);
}

export async function getEditionRoles(
  hackathonId: string,
  memberId: number,
): Promise<EditionRole[]> {
  const rows = await db
    .prepare(
      `SELECT role FROM edition_roles
       WHERE hackathonId = ? AND memberId = ? ORDER BY role`,
    )
    .all<{ role: EditionRole }>(hackathonId, memberId);
  return rows.map((r) => r.role);
}

/** pode agir como `role` nessa edição? admin global e organizador valem por todos */
export async function hasEditionRole(
  actor: Actor | null,
  hackathonId: string,
  role: EditionRole,
): Promise<boolean> {
  if (!actor) return false;
  if (actor.role === "admin") return true;
  const roles = await getEditionRoles(hackathonId, actor.id);
  return roles.includes("organizador") || roles.includes(role);
}

export async function canManageEdition(actor: Actor | null, hackathonId: string) {
  return hasEditionRole(actor, hackathonId, "organizador");
}

export async function grantEditionRole(
  hackathonId: string,
  memberId: number,
  role: EditionRole,
  grantedBy: number | null,
) {
  await db
    .prepare(
      `INSERT OR IGNORE INTO edition_roles (hackathonId, memberId, role, grantedBy)
       VALUES (?, ?, ?, ?)`,
    )
    .run(hackathonId, memberId, role, grantedBy);
}

export async function revokeEditionRole(
  hackathonId: string,
  memberId: number,
  role: EditionRole,
) {
  await db
    .prepare(
      "DELETE FROM edition_roles WHERE hackathonId = ? AND memberId = ? AND role = ?",
    )
    .run(hackathonId, memberId, role);
}

export type EditionTeamEntry = {
  memberId: number;
  username: string;
  name: string | null;
  role: EditionRole;
};

export async function listEditionTeam(hackathonId: string): Promise<EditionTeamEntry[]> {
  return db
    .prepare(
      `SELECT m.id AS memberId, m.username, m.name, er.role
       FROM edition_roles er JOIN members m ON m.id = er.memberId
       WHERE er.hackathonId = ?
       ORDER BY er.role, m.username`,
    )
    .all<EditionTeamEntry>(hackathonId);
}

/**
 * Convida por e-mail. Se já existe membro com esse e-mail, o papel vale na
 * hora; senão fica pendente e é resgatado no primeiro login
 * (claimEditionInvites, chamado em getOrCreateMember).
 */
export async function inviteToEdition(
  hackathonId: string,
  email: string,
  role: EditionRole,
  invitedBy: number | null,
): Promise<"granted" | "pending"> {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error("e-mail inválido");
  const member = await db
    .prepare("SELECT id FROM members WHERE lower(email) = ?")
    .get<{ id: number }>(normalized);
  if (member) {
    await grantEditionRole(hackathonId, member.id, role, invitedBy);
    return "granted";
  }
  await db
    .prepare(
      `INSERT OR IGNORE INTO edition_role_invites (hackathonId, email, role, invitedBy)
       VALUES (?, ?, ?, ?)`,
    )
    .run(hackathonId, normalized, role, invitedBy);
  return "pending";
}

export async function listPendingInvites(hackathonId: string) {
  return db
    .prepare(
      `SELECT email, role, createdAt FROM edition_role_invites
       WHERE hackathonId = ? ORDER BY createdAt`,
    )
    .all<{ email: string; role: EditionRole; createdAt: string }>(hackathonId);
}

export async function cancelEditionInvite(hackathonId: string, email: string, role: EditionRole) {
  await db
    .prepare("DELETE FROM edition_role_invites WHERE hackathonId = ? AND email = ? AND role = ?")
    .run(hackathonId, email.trim().toLowerCase(), role);
}

/** converte convites pendentes do e-mail em papéis do membro recém-chegado */
export async function claimEditionInvites(memberId: number, email: string) {
  const normalized = email.trim().toLowerCase();
  await db.transaction(async () => {
    const invites = await db
      .prepare("SELECT hackathonId, role, invitedBy FROM edition_role_invites WHERE email = ?")
      .all<{ hackathonId: string; role: EditionRole; invitedBy: number | null }>(normalized);
    for (const inv of invites) {
      await grantEditionRole(inv.hackathonId, memberId, inv.role, inv.invitedBy);
    }
    await db.prepare("DELETE FROM edition_role_invites WHERE email = ?").run(normalized);
  })();
}
