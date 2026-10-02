import db from "@/lib/db";

export type TeamProject = {
  title: string;
  description: string | null;
  repoUrl: string | null;
  demoUrl: string | null;
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
    "SELECT title, description, repoUrl, demoUrl FROM team_projects WHERE teamId = ?",
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
              t.placement, tp.title, tp.description, tp.repoUrl, tp.demoUrl
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
            }
          : null,
      };
    });
}
