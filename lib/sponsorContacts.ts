import db from "@/lib/db";
import { getEditionSponsor, SponsorError } from "@/lib/editionSponsors";

// Opt-in de contato pro patrocinador por QR (roadmap 037 #12, pesquisa 034
// §1 "Patrocinador": patrocínio não compra dado de contato; compartilhar só
// com opt-in explícito). O inscrito aprovado abre o link/QR do estande e
// escolhe compartilhar. O que vai é fixo e mostrado antes do aceite;
// revogar tira do relatório na hora. Nada é copiado: o relatório lê o perfil
// no momento, então excluir a conta (lib/privacy) apaga junto (FK memberId).

export const SHARED_FIELDS = ["nome", "e-mail", "LinkedIn", "GitHub", "projeto na edição"] as const;

export type ContactPreview = {
  name: string | null;
  email: string;
  linkedin: string | null;
  github: string | null;
  project: string | null;
};

export type OptInState = { sharedAt: string | null; revokedAt: string | null };

/** dados que iriam pro patrocinador, do jeito que estão no perfil agora */
export async function contactPreview(hackathonId: string, memberId: number): Promise<ContactPreview | null> {
  const row = await db
    .prepare(
      `SELECT m.name, m.email, m.linkedin, m.github,
              (SELECT tp.title FROM teams t
                 JOIN team_members tm ON tm.teamId = t.id
                 LEFT JOIN team_projects tp ON tp.teamId = t.id
               WHERE t.hackathonId = ? AND tm.username = m.username
               ORDER BY t.id LIMIT 1) AS project
       FROM members m WHERE m.id = ?`,
    )
    .get<ContactPreview>(hackathonId, memberId);
  return row ?? null;
}

export async function getOptIn(hackathonId: string, sponsorId: string, memberId: number): Promise<OptInState> {
  const row = await db
    .prepare(
      `SELECT grantedAt, revokedAt FROM sponsor_contact_optins
       WHERE hackathonId = ? AND sponsorId = ? AND memberId = ?`,
    )
    .get<{ grantedAt: string; revokedAt: string | null }>(hackathonId, sponsorId, memberId);
  if (!row) return { sharedAt: null, revokedAt: null };
  return row.revokedAt ? { sharedAt: null, revokedAt: row.revokedAt } : { sharedAt: row.grantedAt, revokedAt: null };
}

/** só inscrito aprovado da edição compartilha (é o público do estande) */
export async function canOptIn(hackathonId: string, memberId: number): Promise<boolean> {
  return !!(await db
    .prepare("SELECT 1 FROM registrations WHERE hackathonId = ? AND memberId = ? AND status = 'approved'")
    .get(hackathonId, memberId));
}

async function requireSponsor(hackathonId: string, sponsorId: string) {
  const s = await getEditionSponsor(hackathonId, sponsorId);
  if (!s) throw new SponsorError("patrocinador não encontrado nesta edição", 404);
  return s;
}

/** aceita (ou reaceita depois de revogar): grantedAt = agora, revokedAt limpo */
export async function shareContact(hackathonId: string, sponsorId: string, memberId: number): Promise<OptInState> {
  await requireSponsor(hackathonId, sponsorId);
  if (!(await canOptIn(hackathonId, memberId))) {
    throw new SponsorError("só inscrito aprovado da edição compartilha contato", 403);
  }
  await db
    .prepare(
      `INSERT INTO sponsor_contact_optins (hackathonId, sponsorId, memberId, fields, grantedAt, revokedAt)
       VALUES (?, ?, ?, ?, sqlite_now(), NULL)
       ON CONFLICT (hackathonId, sponsorId, memberId)
       DO UPDATE SET grantedAt = sqlite_now(), revokedAt = NULL, fields = excluded.fields
       WHERE sponsor_contact_optins.revokedAt IS NOT NULL`,
    )
    .run(hackathonId, sponsorId, memberId, JSON.stringify(SHARED_FIELDS));
  return getOptIn(hackathonId, sponsorId, memberId);
}

/** revoga na hora; a linha fica como registro (com a data), sem dado de contato */
export async function revokeContact(hackathonId: string, sponsorId: string, memberId: number): Promise<OptInState> {
  await requireSponsor(hackathonId, sponsorId);
  await db
    .prepare(
      `UPDATE sponsor_contact_optins SET revokedAt = sqlite_now()
       WHERE hackathonId = ? AND sponsorId = ? AND memberId = ? AND revokedAt IS NULL`,
    )
    .run(hackathonId, sponsorId, memberId);
  return getOptIn(hackathonId, sponsorId, memberId);
}

export type Talent = ContactPreview & { sharedAt: string };

/** quem compartilhou com ESTA marca e não revogou — os únicos com dado pessoal no relatório */
export async function listTalents(hackathonId: string, sponsorId: string): Promise<Talent[]> {
  return db
    .prepare(
      `SELECT m.name, m.email, m.linkedin, m.github, o.grantedAt AS "sharedAt",
              (SELECT tp.title FROM teams t
                 JOIN team_members tm ON tm.teamId = t.id
                 LEFT JOIN team_projects tp ON tp.teamId = t.id
               WHERE t.hackathonId = o.hackathonId AND tm.username = m.username
               ORDER BY t.id LIMIT 1) AS project
       FROM sponsor_contact_optins o JOIN members m ON m.id = o.memberId
       WHERE o.hackathonId = ? AND o.sponsorId = ? AND o.revokedAt IS NULL
       ORDER BY o.grantedAt, m.id`,
    )
    .all<Talent>(hackathonId, sponsorId);
}

export async function countActiveOptIns(hackathonId: string, sponsorId: string): Promise<number> {
  const r = await db
    .prepare(
      `SELECT COUNT(*)::int AS n FROM sponsor_contact_optins
       WHERE hackathonId = ? AND sponsorId = ? AND revokedAt IS NULL`,
    )
    .get<{ n: number }>(hackathonId, sponsorId);
  return Number(r?.n ?? 0);
}
