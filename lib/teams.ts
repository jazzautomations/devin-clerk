import db from "@/lib/db";
import { getArchive, type ArchiveTeam } from "@/lib/archive";

// spec 021 — submissão self-service: o inscrito cria o próprio time+projeto
// na edição. Reusa as tabelas de 003 (teams/team_members/team_projects +
// registrations como gate) — sem schema novo.

// erro de domínio com status HTTP — a rota mapeia sem parsear mensagem
export class TeamError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const httpUrl = (u: string) => /^https?:\/\//i.test(u.trim());

const normUsername = (u: unknown) =>
  String(u ?? "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();

// time do membro na edição (um membro = um time por edição — submitTeam
// garante o invariante) — null quando não participa de nenhum
export function memberTeamFor(
  hackathonId: string,
  username: string,
): ArchiveTeam | null {
  const row = db
    .prepare(
      `SELECT t.id FROM teams t
       JOIN team_members tm ON tm.teamId = t.id
       WHERE t.hackathonId = ? AND tm.username = ?`,
    )
    .get(hackathonId, username) as { id: number } | undefined;
  if (!row) return null;
  return getArchive(hackathonId).teams.find((t) => t.id === row.id) ?? null;
}

export type ProjectInput = {
  title: string;
  description?: string | null;
  repoUrl?: string | null;
  demoUrl?: string | null;
  videoUrl?: string | null;
  logoUrl?: string | null;
};

// projeto é opcional no submit, mas quando veio PRECISA de título —
// engolir o projeto quieto (comportamento do admin em createTeam) aqui
// apagaria o trabalho do membro sem aviso
// spec 030 — videoUrl (pitch) e logoUrl seguem a mesma regra de repo/demo:
// string http(s) ou null; trim antes de validar
function validateProject(input: unknown): {
  title: string;
  description: string | null;
  repoUrl: string | null;
  demoUrl: string | null;
  videoUrl: string | null;
  logoUrl: string | null;
} | null {
  if (input === undefined || input === null) return null;
  if (typeof input !== "object") throw new TeamError("project inválido", 400);
  const p = input as Record<string, unknown>;
  const title = typeof p.title === "string" ? p.title.trim() : "";
  if (!title) throw new TeamError("título do projeto obrigatório", 400);
  const urls: string[] = [];
  for (const k of ["repoUrl", "demoUrl", "videoUrl", "logoUrl"] as const) {
    const raw = p[k];
    if (raw === undefined || raw === null) {
      urls.push("");
    } else {
      if (typeof raw !== "string") throw new TeamError(`${k} inválida`, 400);
      const u = raw.trim();
      if (u && !httpUrl(u)) throw new TeamError("URL inválida — só http(s)", 400);
      urls.push(u);
    }
  }
  const desc =
    typeof p.description === "string" ? p.description.trim() : "";
  return {
    title,
    description: desc || null,
    repoUrl: urls[0] || null,
    demoUrl: urls[1] || null,
    videoUrl: urls[2] || null,
    logoUrl: urls[3] || null,
  };
}

// o inscrito cria o time da edição — placement é SEMPRE 0: pódio é
// condecoração do organizador (admin), nunca autoatribuição. O autor
// entra automaticamente; colegas só entram se forem membros INSCRITOS
// na edição e ainda sem time — o resto volta em ignoredUsernames.
export function submitTeam(
  hackathonId: string,
  member: { username: string },
  input: {
    name: string;
    memberUsernames?: string[];
    project?: ProjectInput | null;
  },
): { team: ArchiveTeam; ignoredUsernames: string[] } {
  const name = String(input.name ?? "").trim();
  if (!name) throw new TeamError("nome do time obrigatório", 400);
  const project = validateProject(input.project);

  if (memberTeamFor(hackathonId, member.username)) {
    throw new TeamError("tu já tens time nesta edição", 409);
  }
  const nameTaken = db
    .prepare("SELECT 1 FROM teams WHERE hackathonId = ? AND name = ?")
    .get(hackathonId, name);
  if (nameTaken) {
    throw new TeamError(`já existe um time "${name}" nesta edição`, 409);
  }

  // colegas: normaliza/dedup, exige inscrição na edição e nenhum time ainda
  const isRegistered = db.prepare(
    `SELECT 1 FROM registrations r
     JOIN members m ON m.id = r.memberId
     WHERE r.hackathonId = ? AND m.username = ?`,
  );
  const ignoredUsernames: string[] = [];
  const colegas: string[] = [];
  for (const raw of input.memberUsernames ?? []) {
    const username = normUsername(raw);
    if (!username || username === member.username) continue;
    if (colegas.includes(username) || ignoredUsernames.includes(username)) {
      continue;
    }
    const ok =
      isRegistered.get(hackathonId, username) &&
      !memberTeamFor(hackathonId, username);
    if (ok) colegas.push(username);
    else ignoredUsernames.push(username);
  }

  const tx = db.transaction(() => {
    const res = db
      .prepare(
        "INSERT INTO teams (hackathonId, name, placement) VALUES (?, ?, 0)",
      )
      .run(hackathonId, name);
    const teamId = Number(res.lastInsertRowid);
    const link = db.prepare(
      "INSERT OR IGNORE INTO team_members (teamId, username) VALUES (?, ?)",
    );
    link.run(teamId, member.username);
    for (const u of colegas) link.run(teamId, u);
    if (project) {
      db.prepare(
        `INSERT INTO team_projects (teamId, title, description, repoUrl, demoUrl, videoUrl, logoUrl)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        teamId,
        project.title,
        project.description,
        project.repoUrl,
        project.demoUrl,
        project.videoUrl,
        project.logoUrl,
      );
    }
    return teamId;
  });
  const teamId = tx();

  const team = getArchive(hackathonId).teams.find((t) => t.id === teamId);
  if (!team) throw new TeamError("falha ao criar time", 500);
  return { team, ignoredUsernames };
}

export type ProjectPatch = {
  title?: string;
  description?: string;
  repoUrl?: string;
  demoUrl?: string;
  videoUrl?: string;
  logoUrl?: string;
};

// integrante edita (ou cria) o projeto do próprio time — upsert em
// team_projects. String vazia limpa campo opcional; título nunca fica
// vazio. Quem não é do time → 403; time inexistente → 404.
export function updateTeamProject(
  teamId: number,
  member: { username: string },
  patch: ProjectPatch,
): ArchiveTeam {
  const team = db
    .prepare("SELECT id, hackathonId FROM teams WHERE id = ?")
    .get(teamId) as { id: number; hackathonId: string } | undefined;
  if (!team) throw new TeamError("time não encontrado", 404);

  const isMember = db
    .prepare("SELECT 1 FROM team_members WHERE teamId = ? AND username = ?")
    .get(teamId, member.username);
  if (!isMember) throw new TeamError("só integrante edita o projeto", 403);

  const fields: { col: string; value: string | null }[] = [];
  if (patch.title !== undefined) {
    if (typeof patch.title !== "string") throw new TeamError("title inválido", 400);
    const t = patch.title.trim();
    if (!t) throw new TeamError("título não pode ficar vazio", 400);
    fields.push({ col: "title", value: t });
  }
  for (const [key, col] of [
    ["description", "description"],
    ["repoUrl", "repoUrl"],
    ["demoUrl", "demoUrl"],
    ["videoUrl", "videoUrl"],
    ["logoUrl", "logoUrl"],
  ] as const) {
    const raw = patch[key];
    if (raw === undefined) continue;
    if (typeof raw !== "string") throw new TeamError(`${key} inválida`, 400);
    const v = raw.trim();
    if (col !== "description" && v && !httpUrl(v)) {
      throw new TeamError("URL inválida — só http(s)", 400);
    }
    fields.push({ col, value: v || null });
  }
  if (fields.length === 0) {
    throw new TeamError("nenhum campo pra atualizar", 400);
  }

  const exists = db
    .prepare("SELECT 1 FROM team_projects WHERE teamId = ?")
    .get(teamId);
  if (exists) {
    db.prepare(
      `UPDATE team_projects SET ${fields.map((f) => `${f.col} = ?`).join(", ")}
       WHERE teamId = ?`,
    ).run(...fields.map((f) => f.value), teamId);
  } else {
    const get = (col: string) =>
      fields.find((f) => f.col === col)?.value ?? null;
    const title = get("title");
    if (!title) throw new TeamError("título do projeto obrigatório", 400);
    db.prepare(
      `INSERT INTO team_projects (teamId, title, description, repoUrl, demoUrl, videoUrl, logoUrl)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      teamId,
      title,
      get("description"),
      get("repoUrl"),
      get("demoUrl"),
      get("videoUrl"),
      get("logoUrl"),
    );
  }

  return memberTeamFor(team.hackathonId, member.username)!;
}
