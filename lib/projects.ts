import db from "@/lib/db";
import { getLatestDeployForTeam } from "@/lib/deploys";
import type { TeamProject } from "@/lib/archive";

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
  project: TeamProject;
};

export type ProjectFilter = {
  hackathonId?: string;
  liveOnly?: boolean;
};

type Row = {
  teamId: number;
  teamName: string;
  placement: number;
  hackathonId: string;
  hackathonName: string;
  memberCount: number;
  title: string;
  description: string | null;
  repoUrl: string | null;
  demoUrl: string | null;
};

export function listProjects(filter: ProjectFilter = {}): ProjectCard[] {
  const rows = db
    .prepare(
      `SELECT t.id AS teamId, t.name AS teamName, t.placement,
              t.hackathonId, h.name AS hackathonName,
              tp.title, tp.description, tp.repoUrl, tp.demoUrl,
              (SELECT COUNT(*) FROM team_members tm WHERE tm.teamId = t.id)
                AS memberCount
       FROM teams t
       JOIN team_projects tp ON tp.teamId = t.id
       JOIN hackathons h ON h.id = t.hackathonId
       WHERE (@h IS NULL OR t.hackathonId = @h)
       ORDER BY CASE WHEN t.placement = 0 THEN 99 ELSE t.placement END,
                h.startsAt DESC,
                t.id`,
    )
    .all({ h: filter.hackathonId ?? null }) as Row[];

  const cards = rows.map((r) => {
    const deploy = getLatestDeployForTeam(r.teamId);
    return {
      teamId: r.teamId,
      teamName: r.teamName,
      placement: r.placement,
      hackathonId: r.hackathonId,
      hackathonName: r.hackathonName,
      memberCount: r.memberCount,
      liveDeployId: deploy?.status === "running" ? deploy.id : null,
      project: {
        title: r.title,
        description: r.description,
        repoUrl: r.repoUrl,
        demoUrl: r.demoUrl,
      },
    };
  });

  return filter.liveOnly ? cards.filter((c) => c.liveDeployId) : cards;
}

/** edições que têm pelo menos um projeto — chips do filtro ?h= */
export function listProjectEditions(): { id: string; name: string }[] {
  return db
    .prepare(
      `SELECT DISTINCT h.id, h.name
       FROM teams t
       JOIN team_projects tp ON tp.teamId = t.id
       JOIN hackathons h ON h.id = t.hackathonId
       ORDER BY h.startsAt DESC`,
    )
    .all() as { id: string; name: string }[];
}
