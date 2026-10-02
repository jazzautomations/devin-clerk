import db from "@/lib/db";
import { getLatestDeployForTeam } from "@/lib/deploys";
import { toLikePattern } from "@/lib/search";
import type { TeamProject } from "@/lib/archive";
// garante o ALTER de videoUrl/logoUrl em team_projects (spec 030) — o
// import acima é type-only, não roda o módulo; mesmo espírito do import
// de efeito abaixo pra votes
import "@/lib/archive";
import "@/lib/votes"; // garante a tabela votes (schema próprio — spec 025)

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
};

export type ProjectFilter = {
  hackathonId?: string;
  liveOnly?: boolean;
  /** ?q= — título do projeto, descrição ou nome do time (spec 023) */
  q?: string;
  /** ?sort=votes — escolha do povo: votos desc; default = pódio do júri */
  sort?: "jury" | "votes";
  /** memberId logado — alimenta votedByMe (pattern likedByMe de posts) */
  meId?: number | null;
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
  title: string;
  description: string | null;
  repoUrl: string | null;
  demoUrl: string | null;
  videoUrl: string | null;
  logoUrl: string | null;
};

export function listProjects(filter: ProjectFilter = {}): ProjectCard[] {
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
  const rows = db
    .prepare(
      `SELECT t.id AS teamId, t.name AS teamName, t.placement,
              t.hackathonId, h.name AS hackathonName,
              tp.title, tp.description, tp.repoUrl, tp.demoUrl,
              tp.videoUrl, tp.logoUrl,
              (SELECT COUNT(*) FROM team_members tm WHERE tm.teamId = t.id)
                AS memberCount,
              (SELECT COUNT(*) FROM votes v WHERE v.teamId = t.id)
                AS voteCount,
              EXISTS(SELECT 1 FROM votes v
                     WHERE v.teamId = t.id AND v.memberId = @me) AS votedByMe
       FROM teams t
       JOIN team_projects tp ON tp.teamId = t.id
       JOIN hackathons h ON h.id = t.hackathonId
       WHERE (@h IS NULL OR t.hackathonId = @h)
         AND (@q IS NULL
              OR tp.title LIKE @q ESCAPE '\\'
              OR tp.description LIKE @q ESCAPE '\\'
              OR t.name LIKE @q ESCAPE '\\')
       ORDER BY ${orderBy}`,
    )
    .all({
      h: filter.hackathonId ?? null,
      q: toLikePattern(filter.q),
      me: filter.meId ?? -1,
    }) as Row[];

  const cards = rows.map((r) => {
    const deploy = getLatestDeployForTeam(r.teamId);
    return {
      teamId: r.teamId,
      teamName: r.teamName,
      placement: r.placement,
      hackathonId: r.hackathonId,
      hackathonName: r.hackathonName,
      memberCount: r.memberCount,
      voteCount: r.voteCount,
      votedByMe: Boolean(r.votedByMe),
      liveDeployId: deploy?.status === "running" ? deploy.id : null,
      project: {
        title: r.title,
        description: r.description,
        repoUrl: r.repoUrl,
        demoUrl: r.demoUrl,
        videoUrl: r.videoUrl,
        logoUrl: r.logoUrl,
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
