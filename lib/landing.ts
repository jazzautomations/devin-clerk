import db from "@/lib/db";
import { getPastHackathons, type Hackathon } from "@/lib/hackathons";

// spec 039 — prova da landing, só com número que existe no banco. Quem
// renderiza esconde o item zerado (e a seção, se tudo zerar).

export type CommunityProof = {
  /** edições Hack Inova já realizadas (encerradas) */
  editions: number;
  /** inscrições aprovadas em edições Hack Inova */
  registrations: number;
  /** projetos cadastrados por times */
  projects: number;
  /** membros com perfil (conta anonimizada não conta) */
  members: number;
};

const PARTNER = `lower(h.organizer) LIKE '%hack inova%'`;

export async function getCommunityProof(now = new Date()): Promise<CommunityProof> {
  const past = (await getPastHackathons(now)).filter((h) => h.partner);
  const count = async (sql: string) => Number((await db.prepare(sql).get<{ n: number | string }>())?.n ?? 0);
  const [registrations, projects, members] = await Promise.all([
    count(
      `SELECT COUNT(*) n FROM registrations r JOIN hackathons h ON h.id = r.hackathonId
       WHERE r.status = 'approved' AND h.active = 1 AND ${PARTNER}`,
    ),
    count(
      `SELECT COUNT(*) n FROM team_projects p JOIN teams t ON t.id = p.teamId
       JOIN hackathons h ON h.id = t.hackathonId WHERE h.active = 1`,
    ),
    count(`SELECT COUNT(*) n FROM members WHERE clerkId NOT LIKE 'deleted:%'`),
  ]);
  return { editions: past.length, registrations, projects, members };
}

export type Champion = {
  teamId: number;
  teamName: string;
  placement: number;
  title: string;
  description: string | null;
  hackathonId: string;
  hackathonName: string;
  startsAt: string;
  members: string[];
};

/**
 * Pódio das edições encerradas (projeto + time + edição): os 1º lugares
 * primeiro, da edição mais recente pra mais antiga, depois 2º e 3º.
 * Só edição encerrada: antes do prazo de entrega o arquivo não expõe
 * projeto (spec 034).
 */
export async function getChampions(limit = 6, now = new Date()): Promise<Champion[]> {
  const past = await getPastHackathons(now);
  if (past.length === 0) return [];
  const byId = new Map<string, Hackathon>(past.map((h) => [h.id, h]));
  const rows = await db
    .prepare(
      `SELECT t.id AS "teamId", t.name AS "teamName", t.placement, p.title, p.description,
              t.hackathonId AS "hackathonId"
       FROM teams t JOIN team_projects p ON p.teamId = t.id
       WHERE t.placement BETWEEN 1 AND 3 AND t.hackathonId = ANY(?::text[])`,
    )
    .all<Omit<Champion, "hackathonName" | "startsAt" | "members">>(`{${past.map((h) => `"${h.id.replace(/"/g, "")}"`).join(",")}}`);
  const ordered = rows
    .map((r) => ({ ...r, hackathonName: byId.get(r.hackathonId)!.name, startsAt: byId.get(r.hackathonId)!.startsAt }))
    // campeões primeiro (1º de cada edição, da mais recente), depois 2º e 3º
    .sort((a, b) => a.placement - b.placement || new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime())
    .slice(0, limit);
  if (ordered.length === 0) return [];
  const members = await db
    .prepare(`SELECT "teamId", username FROM team_members WHERE "teamId" = ANY(?::int[]) ORDER BY username`)
    .all<{ teamId: number; username: string }>(`{${ordered.map((c) => c.teamId).join(",")}}`);
  return ordered.map((c) => ({ ...c, members: members.filter((m) => m.teamId === c.teamId).map((m) => m.username) }));
}
