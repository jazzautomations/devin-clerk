import db, { ensureColumn } from "@/lib/db";

// spec 032 — o arco do builder conta só inscrições aprovadas (pendente é
// candidato, não participação); guarda da coluna status — dona do schema é
// lib/registrations, aqui garante pra quem importa archive.ts direto
ensureColumn(
  "registrations",
  "status",
  "status TEXT NOT NULL DEFAULT 'approved'",
);

// spec 030 — submissão rica (portal Colosseum): pitch em vídeo + logo do
// projeto. Colunas chegam por ALTER guardado aqui mesmo — lib/db.ts fica
// intocado
ensureColumn("team_projects", "videoUrl", "videoUrl TEXT");
ensureColumn("team_projects", "logoUrl", "logoUrl TEXT");

export type TeamProject = {
  title: string;
  description: string | null;
  repoUrl: string | null;
  demoUrl: string | null;
  videoUrl: string | null;
  logoUrl: string | null;
};

export type ArchiveTeam = {
  id: number;
  name: string;
  placement: number; // 1/2/3 = pódio; 0 = participante
  members: string[];
  project: TeamProject | null;
};

export type EditionAsset = {
  id: number;
  type: "foto" | "slide" | "material";
  url: string;
  caption: string | null;
};

export type EditionArchive = {
  teams: ArchiveTeam[];
  assets: EditionAsset[];
};

const httpUrl = (u: string) => /^https?:\/\//i.test(u.trim());

export function getArchive(hackathonId: string): EditionArchive {
  const teams = db
    .prepare(
      `SELECT id, name, placement FROM teams
       WHERE hackathonId = ?
       ORDER BY CASE WHEN placement = 0 THEN 99 ELSE placement END, name`,
    )
    .all(hackathonId) as { id: number; name: string; placement: number }[];

  const memberStmt = db.prepare(
    "SELECT username FROM team_members WHERE teamId = ? ORDER BY username",
  );
  const projectStmt = db.prepare(
    "SELECT title, description, repoUrl, demoUrl, videoUrl, logoUrl FROM team_projects WHERE teamId = ?",
  );

  const assets = db
    .prepare(
      "SELECT id, type, url, caption FROM edition_assets WHERE hackathonId = ? ORDER BY id",
    )
    .all(hackathonId) as EditionAsset[];

  return {
    teams: teams.map((t) => ({
      ...t,
      members: (memberStmt.all(t.id) as { username: string }[]).map(
        (m) => m.username,
      ),
      project: (projectStmt.get(t.id) as TeamProject | undefined) ?? null,
    })),
    assets,
  };
}

export function createTeam(
  hackathonId: string,
  input: {
    name: string;
    placement: number;
    memberUsernames?: string[];
    project?: {
      title: string;
      description?: string | null;
      repoUrl?: string | null;
      demoUrl?: string | null;
    } | null;
  },
): { team: ArchiveTeam; ignoredUsernames: string[] } {
  const name = input.name.trim();
  if (!name) throw new Error("Nome do time obrigatório");
  const placement = Number.isInteger(input.placement)
    ? input.placement
    : 0;

  const res = db
    .prepare(
      "INSERT INTO teams (hackathonId, name, placement) VALUES (?, ?, ?)",
    )
    .run(hackathonId, name, placement);
  const teamId = Number(res.lastInsertRowid);

  const ignoredUsernames: string[] = [];
  const memberExists = db.prepare(
    "SELECT 1 FROM members WHERE username = ?",
  );
  const link = db.prepare(
    "INSERT OR IGNORE INTO team_members (teamId, username) VALUES (?, ?)",
  );
  for (const u of input.memberUsernames ?? []) {
    const username = String(u).trim().replace(/^@/, "").toLowerCase();
    if (!username) continue;
    if (memberExists.get(username)) link.run(teamId, username);
    else ignoredUsernames.push(username);
  }

  if (input.project?.title?.trim()) {
    const p = input.project;
    for (const u of [p.repoUrl, p.demoUrl]) {
      if (u && !httpUrl(u)) throw new Error("URL inválida");
    }
    db.prepare(
      `INSERT INTO team_projects (teamId, title, description, repoUrl, demoUrl)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      teamId,
      p.title.trim(),
      p.description?.trim() || null,
      p.repoUrl?.trim() || null,
      p.demoUrl?.trim() || null,
    );
  }

  const team = getArchive(hackathonId).teams.find((t) => t.id === teamId)!;
  return { team, ignoredUsernames };
}

export function addAsset(
  hackathonId: string,
  input: { type: string; url: string; caption?: string | null },
): EditionAsset {
  if (!["foto", "slide", "material"].includes(input.type)) {
    throw new Error("type inválido — use foto, slide ou material");
  }
  const url = input.url?.trim() ?? "";
  if (!httpUrl(url)) throw new Error("URL inválida");
  const res = db
    .prepare(
      "INSERT INTO edition_assets (hackathonId, type, url, caption) VALUES (?, ?, ?, ?)",
    )
    .run(hackathonId, input.type, url, input.caption?.trim() || null);
  return {
    id: Number(res.lastInsertRowid),
    type: input.type as EditionAsset["type"],
    url,
    caption: input.caption?.trim() || null,
  };
}

export type MemberProject = {
  hackathonId: string;
  hackathonName: string;
  teamId: number;
  teamName: string;
  placement: number;
  project: TeamProject | null;
};

export function getMemberProjects(username: string): MemberProject[] {
  return db
    .prepare(
      `SELECT t.hackathonId, h.name AS hackathonName, t.id AS teamId, t.name AS teamName,
              t.placement, tp.title, tp.description, tp.repoUrl, tp.demoUrl,
              tp.videoUrl, tp.logoUrl
       FROM team_members tm
       JOIN teams t ON t.id = tm.teamId
       JOIN hackathons h ON h.id = t.hackathonId
       LEFT JOIN team_projects tp ON tp.teamId = t.id
       WHERE tm.username = ?
       ORDER BY h.startsAt DESC`,
    )
    .all(username)
    .map((r) => {
      const row = r as {
        hackathonId: string;
        hackathonName: string;
        teamId: number;
        teamName: string;
        placement: number;
        title: string | null;
        description: string | null;
        repoUrl: string | null;
        demoUrl: string | null;
        videoUrl: string | null;
        logoUrl: string | null;
      };
      return {
        hackathonId: row.hackathonId,
        hackathonName: row.hackathonName,
        teamId: row.teamId,
        teamName: row.teamName,
        placement: row.placement,
        project: row.title
          ? {
              title: row.title,
              description: row.description,
              repoUrl: row.repoUrl,
              demoUrl: row.demoUrl,
              videoUrl: row.videoUrl,
              logoUrl: row.logoUrl,
            }
          : null,
      };
    });
}

export type MemberArcEntry = {
  hackathonId: string;
  hackathonName: string;
  startsAt: string;
  teamId: number | null; // null quando participou sem time (só inscrição)
  teamName: string | null;
  placement: number; // 1/2/3 = pódio; 0 = sem pódio
  hasProject: boolean; // o time entregou projeto
};

// spec 029 — trajetória do builder: união de inscrições (memberId) e vínculos
// de time (username) por edição, cronológica antiga→nova. Vínculo sem inscrição
// conta (admin arquiva quem competiu sem passar pelo register); inscrito+time
// na mesma edição vira uma entrada só, com os dados do time. Membro em dois
// times na edição (legado) pega o de melhor placement — determinístico.
export function getMemberArc(username: string): MemberArcEntry[] {
  const rows = db
    .prepare(
      `WITH editions AS (
         SELECT r.hackathonId
         FROM registrations r
         JOIN members m ON m.id = r.memberId
         WHERE m.username = @username AND r.status = 'approved'
         UNION
         SELECT t.hackathonId
         FROM team_members tm
         JOIN teams t ON t.id = tm.teamId
         WHERE tm.username = @username
       )
       SELECT h.id AS hackathonId, h.name AS hackathonName, h.startsAt,
              t.id AS teamId, t.name AS teamName,
              COALESCE(t.placement, 0) AS placement,
              CASE WHEN tp.teamId IS NULL THEN 0 ELSE 1 END AS hasProject
       FROM editions e
       JOIN hackathons h ON h.id = e.hackathonId
       LEFT JOIN teams t ON t.id = (
         SELECT t2.id
         FROM team_members tm2
         JOIN teams t2 ON t2.id = tm2.teamId
         WHERE tm2.username = @username AND t2.hackathonId = h.id
         ORDER BY CASE WHEN t2.placement BETWEEN 1 AND 3
                       THEN t2.placement ELSE 99 END,
                  t2.id
         LIMIT 1
       )
       LEFT JOIN team_projects tp ON tp.teamId = t.id
       ORDER BY h.startsAt ASC, h.id ASC`,
    )
    .all({ username }) as {
    hackathonId: string;
    hackathonName: string;
    startsAt: string;
    teamId: number | null;
    teamName: string | null;
    placement: number;
    hasProject: number;
  }[];

  return rows.map((r) => ({
    hackathonId: r.hackathonId,
    hackathonName: r.hackathonName,
    startsAt: r.startsAt,
    teamId: r.teamId,
    teamName: r.teamName,
    placement: r.placement,
    hasProject: r.hasProject === 1,
  }));
}

export type ProjectPage = {
  teamId: number;
  teamName: string;
  placement: number; // 1/2/3 = pódio; 0 = participante
  hackathonId: string;
  hackathonName: string;
  members: string[];
  project: TeamProject;
};

/** ficha pública do projeto (/p/[teamId]) — null quando o time ou o projeto não existem */
export function getProjectByTeamId(teamId: number): ProjectPage | null {
  const row = db
    .prepare(
      `SELECT t.id AS teamId, t.name AS teamName, t.placement,
              t.hackathonId, h.name AS hackathonName,
              tp.title, tp.description, tp.repoUrl, tp.demoUrl,
              tp.videoUrl, tp.logoUrl
       FROM teams t
       JOIN hackathons h ON h.id = t.hackathonId
       JOIN team_projects tp ON tp.teamId = t.id
       WHERE t.id = ?`,
    )
    .get(teamId) as
    | {
        teamId: number;
        teamName: string;
        placement: number;
        hackathonId: string;
        hackathonName: string;
        title: string;
        description: string | null;
        repoUrl: string | null;
        demoUrl: string | null;
        videoUrl: string | null;
        logoUrl: string | null;
      }
    | undefined;
  if (!row) return null;

  const members = (
    db
      .prepare(
        "SELECT username FROM team_members WHERE teamId = ? ORDER BY username",
      )
      .all(teamId) as { username: string }[]
  ).map((m) => m.username);

  return {
    teamId: row.teamId,
    teamName: row.teamName,
    placement: row.placement,
    hackathonId: row.hackathonId,
    hackathonName: row.hackathonName,
    members,
    project: {
      title: row.title,
      description: row.description,
      repoUrl: row.repoUrl,
      demoUrl: row.demoUrl,
      videoUrl: row.videoUrl,
      logoUrl: row.logoUrl,
    },
  };
}
