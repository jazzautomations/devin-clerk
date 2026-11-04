import db from "@/lib/db";
import { toLikePattern } from "@/lib/search";
import { ABANDONED_SQL, type TeamProject } from "@/lib/archive";
import { normalizeTech, parseTechEntries, type TechEntry } from "@/lib/techTags";

// Índice público de projetos (spec 017) — o "/companies" do Colosseum:
// todo time que ENTREGOU vira card, cruzando edições. INNER JOIN em
// team_projects: time sem projeto não aparece (o arquivo /h já o lista).

export type ProjectCard = {
  teamId: number;
  teamName: string;
  placement: number; // 1/2/3 = pódio; 0 = participante
  hackathonId: string;
  hackathonName: string;
  memberCount: number;
  /** id do deploy quando o ÚLTIMO deploy do time tá running; null caso contrário */
  liveDeployId: string | null;
  /** votos da comunidade — escolha do povo (spec 025), sinal separado do pódio */
  voteCount: number;
  /** true quando meId foi passado e o membro votou nesse projeto */
  votedByMe: boolean;
  project: TeamProject;
  /** até 3 tecnologias do projeto, na ordem do time (chips do card) */
  tech: TechEntry[];
};

/** cards por página em /projetos */
export const PROJECTS_PAGE_SIZE = 24;

// Projeto que aparece no índice: edição com prazo só expõe projeto ENVIADO
// e depois da trava (spec 034); time abandonado fica fora. Precisa de t e h.
const LISTED_SQL = `(h.submissionDeadline IS NULL
    OR (to_ts(h.submissionDeadline) + make_interval(mins => h.submissionGraceMinutes) < now()
        AND EXISTS (SELECT 1 FROM project_submissions ps WHERE ps.teamId = t.id)))
  AND NOT ${ABANDONED_SQL("t")}`;

export type ProjectFilter = {
  hackathonId?: string;
  liveOnly?: boolean;
  /** ?q= — título do projeto, descrição ou nome do time (spec 023) */
  q?: string;
  /** ?sort=votes — escolha do povo: votos desc; default = pódio do júri */
  sort?: "jury" | "votes";
  /** memberId logado — alimenta votedByMe (pattern likedByMe de posts) */
  meId?: number | null;
  /** ?tech= — tag normalizada de project_tech (migration 036) */
  tech?: string;
  /** paginação opcional (a vitrine é pública e cresce com o acervo) */
  limit?: number;
  offset?: number;
};

type Row = {
  teamId: number;
  teamName: string;
  placement: number;
  hackathonId: string;
  hackathonName: string;
  memberCount: number;
  voteCount: number;
  votedByMe: number;
  liveDeployId: string | null;
  title: string;
  description: string | null;
  repoUrl: string | null;
  demoUrl: string | null;
  videoUrl: string | null;
  logoUrl: string | null;
  technologies: string | null;
};

const techList = (v: string | null): unknown[] => {
  try {
    const p = JSON.parse(v ?? "[]");
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
};

/**
 * Quem aparece no índice público de projetos (/projetos) e na busca
 * (lib/search.ts): edição com prazo só expõe projeto ENVIADO e depois da
 * trava (spec 034), e time abandonado fica de fora. `t` = alias de teams,
 * `h` = alias de hackathons.
 */
export function projectVisibleSql(t = "t", h = "h"): string {
  return `(${h}.submissionDeadline IS NULL
              OR (to_ts(${h}.submissionDeadline) + make_interval(mins => ${h}.submissionGraceMinutes) < now()
                  AND EXISTS (SELECT 1 FROM project_submissions ps WHERE ps.teamId = ${t}.id)))
         AND NOT ${ABANDONED_SQL(t)}`;
}

export async function listProjects(filter: ProjectFilter = {}): Promise<ProjectCard[]> {
  // default = pódio do júri (placement→edição recente); "votes" põe a escolha
  // do povo na frente, com o júri só desempatando — sinais separados
  const orderBy =
    filter.sort === "votes"
      ? `voteCount DESC,
         CASE WHEN t.placement = 0 THEN 99 ELSE t.placement END,
         h.startsAt DESC,
         t.id`
      : `CASE WHEN t.placement = 0 THEN 99 ELSE t.placement END,
         h.startsAt DESC,
         t.id`;
  const rows = await db
    .prepare(
      `SELECT t.id AS teamId, t.name AS teamName, t.placement,
              t.hackathonId, h.name AS hackathonName,
              tp.title, tp.description, tp.repoUrl, tp.demoUrl,
              tp.videoUrl, tp.logoUrl, tp.technologies,
              (SELECT COUNT(*) FROM team_members tm WHERE tm.teamId = t.id)
                AS memberCount,
              (SELECT COUNT(*) FROM votes v WHERE v.teamId = t.id)
                AS voteCount,
              EXISTS(SELECT 1 FROM votes v
                     WHERE v.teamId = t.id AND v.memberId = @me) AS votedByMe,
              CASE WHEN d.status = 'running' THEN d.id END AS liveDeployId
       FROM teams t
       JOIN team_projects tp ON tp.teamId = t.id
       JOIN hackathons h ON h.id = t.hackathonId
       -- último deploy do time no mesmo SELECT (antes: 1 query por card)
       LEFT JOIN LATERAL (
         SELECT dd.id, dd.status FROM deploys dd
         WHERE dd.teamId = t.id ORDER BY dd.createdAt DESC LIMIT 1
       ) d ON TRUE
       WHERE (@h::text IS NULL OR t.hackathonId = @h)
         AND (@live::int = 0 OR d.status = 'running')
         AND ${projectVisibleSql("t", "h")}
         AND (@tech::text IS NULL
              OR EXISTS (SELECT 1 FROM project_tech pt WHERE pt.teamId = t.id AND pt.tag = @tech))
         AND (@q::text IS NULL
              OR tp.title LIKE @q ESCAPE '\\'
              OR tp.description LIKE @q ESCAPE '\\'
              OR t.name LIKE @q ESCAPE '\\')
       ORDER BY ${orderBy}
       LIMIT @limit OFFSET @offset`,
    )
    .all({
      h: filter.hackathonId ?? null,
      q: toLikePattern(filter.q),
      me: filter.meId ?? -1,
      live: filter.liveOnly ? 1 : 0,
      tech: filter.tech ? (normalizeTech(filter.tech) ?? "!") : null,
      limit: filter.limit ?? null,
      offset: filter.offset ?? 0,
    }) as Row[];

  return rows.map((r) => {
    return {
      teamId: r.teamId,
      teamName: r.teamName,
      placement: r.placement,
      hackathonId: r.hackathonId,
      hackathonName: r.hackathonName,
      memberCount: r.memberCount,
      voteCount: r.voteCount,
      votedByMe: Boolean(r.votedByMe),
      liveDeployId: r.liveDeployId ?? null,
      project: {
        title: r.title,
        description: r.description,
        repoUrl: r.repoUrl,
        demoUrl: r.demoUrl,
        videoUrl: r.videoUrl,
        logoUrl: r.logoUrl,
      },
      tech: parseTechEntries(techList(r.technologies)).slice(0, 3),
    };
  });
}

/** tags mais usadas entre os projetos do índice — chips do filtro ?tech= */
export async function listTopTech(limit = 20): Promise<{ tag: string; count: number }[]> {
  return db
    .prepare(
      `SELECT pt.tag, COUNT(*)::int AS count
       FROM project_tech pt
       JOIN teams t ON t.id = pt.teamId
       JOIN team_projects tp ON tp.teamId = t.id
       JOIN hackathons h ON h.id = t.hackathonId
       WHERE ${LISTED_SQL}
       GROUP BY pt.tag
       ORDER BY COUNT(*) DESC, pt.tag
       LIMIT ?`,
    )
    .all<{ tag: string; count: number }>(limit);
}

/** edições que têm pelo menos um projeto — chips do filtro ?h= */
export async function listProjectEditions(): Promise<{ id: string; name: string }[]> {
  return await db
    .prepare(
      `SELECT DISTINCT h.id, h.name, h.startsAt
       FROM teams t
       JOIN team_projects tp ON tp.teamId = t.id
       JOIN hackathons h ON h.id = t.hackathonId
       ORDER BY h.startsAt DESC`,
    )
    .all() as { id: string; name: string }[];
}
