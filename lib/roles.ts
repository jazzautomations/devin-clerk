import db from "@/lib/db";
import { notify } from "@/lib/notifications";
import { emailDriver } from "@/lib/notify/email";
import { absoluteUrl } from "@/lib/seo";

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

/** spec 039 — edições em que o membro é da equipe (atalho no /dashboard) */
export async function listMyEditionRoles(
  memberId: number,
): Promise<{ hackathonId: string; hackathonName: string; startsAt: string; roles: EditionRole[] }[]> {
  const rows = await db
    .prepare(
      `SELECT er.hackathonId, h.name AS "hackathonName", h.startsAt, er.role
       FROM edition_roles er JOIN hackathons h ON h.id = er.hackathonId
       WHERE er.memberId = ? AND h.active = 1
       ORDER BY h.startsAt DESC, er.role`,
    )
    .all<{ hackathonId: string; hackathonName: string; startsAt: string; role: EditionRole }>(memberId);
  const out = new Map<string, { hackathonId: string; hackathonName: string; startsAt: string; roles: EditionRole[] }>();
  for (const r of rows) {
    const cur = out.get(r.hackathonId) ?? { hackathonId: r.hackathonId, hackathonName: r.hackathonName, startsAt: r.startsAt, roles: [] };
    cur.roles.push(r.role);
    out.set(r.hackathonId, cur);
  }
  return [...out.values()];
}

export async function canManageEdition(actor: Actor | null, hackathonId: string) {
  return hasEditionRole(actor, hackathonId, "organizador");
}

// aba que cada papel usa primeiro no painel (o link do convite leva direto)
const ROLE_TAB: Record<EditionRole, string> = {
  organizador: "",
  staff: "/checkin",
  mentor: "/duvidas",
  jurado: "/juri",
};
const ROLE_LABEL: Record<EditionRole, string> = {
  organizador: "organização",
  staff: "staff",
  mentor: "mentoria",
  jurado: "júri",
};

export const editionRoleHref = (hackathonId: string, role: EditionRole) =>
  `/admin/h/${hackathonId}${ROLE_TAB[role]}`;

async function editionName(hackathonId: string): Promise<string> {
  const h = await db.prepare("SELECT name FROM hackathons WHERE id = ?").get<{ name: string }>(hackathonId);
  return h?.name ?? "a edição";
}

/**
 * Dá o papel. Quando o papel é novo, a pessoa recebe uma notificação no site
 * com o link da aba dela no painel (antes ninguém avisava e o link do painel
 * não aparecia em lugar nenhum pra quem não é admin).
 */
export async function grantEditionRole(
  hackathonId: string,
  memberId: number,
  role: EditionRole,
  grantedBy: number | null,
) {
  const res = await db
    .prepare(
      `INSERT OR IGNORE INTO edition_roles (hackathonId, memberId, role, grantedBy)
       VALUES (?, ?, ?, ?)`,
    )
    .run(hackathonId, memberId, role, grantedBy);
  if (res.changes > 0 && memberId !== grantedBy) {
    await notify(memberId, {
      type: "edition_role",
      text: `Você entrou na equipe de ${await editionName(hackathonId)} (${ROLE_LABEL[role]}). Abra o painel da edição.`,
      href: editionRoleHref(hackathonId, role),
    });
  }
}

/**
 * Tira o papel. Jurado revogado perde também os projetos atribuídos, na
 * mesma transação: sem isso a atribuição continuava valendo e a pessoa
 * seguia mandando nota pela API.
 */
export async function revokeEditionRole(
  hackathonId: string,
  memberId: number,
  role: EditionRole,
) {
  await db.transaction(async () => {
    await db
      .prepare(
        "DELETE FROM edition_roles WHERE hackathonId = ? AND memberId = ? AND role = ?",
      )
      .run(hackathonId, memberId, role);
    // histórico só cresce: a regra antifarm de lib/evidence.ts olha quem já
    // foi organizador da edição, não só quem é hoje
    await db
      .prepare("INSERT INTO edition_role_revocations (hackathonId, memberId, role) VALUES (?, ?, ?)")
      .run(hackathonId, memberId, role);
    if (role === "jurado") {
      await db
        .prepare("DELETE FROM judge_assignments WHERE hackathonId = ? AND judgeMemberId = ?")
        .run(hackathonId, memberId);
    }
  })();
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
  await sendInviteEmail(hackathonId, normalized, role);
  return "pending";
}

/**
 * Convite pra quem ainda não tem conta: só existe por e-mail. Sem e-mail
 * configurado (driver "log") nada sai e o painel continua mostrando o convite
 * como pendente. Nunca derruba o convite: falha de envio fica no log.
 */
async function sendInviteEmail(hackathonId: string, email: string, role: EditionRole) {
  const driver = emailDriver();
  if (driver.name === "log") return;
  const name = await editionName(hackathonId);
  const url = absoluteUrl(editionRoleHref(hackathonId, role));
  const text = `Você foi convidado pra equipe de ${name} (${ROLE_LABEL[role]}) no HackaHub.\n\nEntre com este e-mail pra ativar o convite: ${url}`;
  const esc = (v: string) => v.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const outcome = await driver
    .send({
      to: email,
      subject: `Convite pra equipe de ${name}`,
      text,
      html: `<p>Você foi convidado pra equipe de <strong>${esc(name)}</strong> (${ROLE_LABEL[role]}) no HackaHub.</p><p><a href="${esc(url)}">Entre com este e-mail pra ativar o convite</a>.</p>`,
      idempotencyKey: `edition-invite:${hackathonId}:${role}:${email}`,
    })
    .catch((e: unknown) => ({ status: "failed" as const, error: String(e) }));
  if (outcome.status !== "sent") console.warn(`[roles] convite por e-mail não saiu: ${outcome.status}`);
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
