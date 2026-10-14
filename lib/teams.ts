import db from "@/lib/db";
import { notify } from "@/lib/notifications";
import { classifyInvitees, createInvites, type IgnoredInvite } from "@/lib/teamInvites";
import { deactivateBoardEntry } from "@/lib/teamboard";
import type { ArchiveTeam, TeamProject } from "@/lib/archive";
import {
  assertEvaluatedEditable,
  deadlinePassed,
  EntryError,
  formatBrt,
  getSubmissionSettings,
  parseDbTime,
} from "@/lib/entries";

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

type TeamRow = { id: number; name: string; placement: number; projectTitle: string | null } & Omit<TeamProject, "title">;

/** time por id no formato do arquivo — 2 queries (time+projeto, integrantes) */
async function teamView(where: string, ...args: unknown[]): Promise<ArchiveTeam | null> {
  const t = await db
    .prepare(
      `SELECT t.id, t.name, t.placement, tp.title AS "projectTitle", tp.description,
              tp.repoUrl, tp.demoUrl, tp.videoUrl, tp.logoUrl
       FROM teams t LEFT JOIN team_projects tp ON tp.teamId = t.id
       WHERE ${where} ORDER BY t.id LIMIT 1`,
    )
    .get<TeamRow>(...args);
  if (!t) return null;
  const members = await db
    .prepare("SELECT username FROM team_members WHERE teamId = ? ORDER BY username")
    .all<{ username: string }>(t.id);
  return {
    id: t.id,
    name: t.name,
    placement: t.placement,
    members: members.map((m) => m.username),
    project:
      t.projectTitle === null
        ? null
        : {
            title: t.projectTitle,
            description: t.description,
            repoUrl: t.repoUrl,
            demoUrl: t.demoUrl,
            videoUrl: t.videoUrl,
            logoUrl: t.logoUrl,
          },
  };
}

// time do membro na edição (um membro = um time por edição — submitTeam
// garante o invariante) — null quando não participa de nenhum
export async function memberTeamFor(
  hackathonId: string,
  username: string,
): Promise<ArchiveTeam | null> {
  return teamView(
    "t.hackathonId = ? AND EXISTS (SELECT 1 FROM team_members tm WHERE tm.teamId = t.id AND tm.username = ?)",
    hackathonId,
    username,
  );
}

// um membro = um time por edição. Criar time e aceitar convite checam isso
// e escrevem dentro desta trava (por edição + username): dois cliques ou duas
// abas ao mesmo tempo não colocam a pessoa em dois times.
export async function lockMemberInEdition(hackathonId: string, username: string): Promise<void> {
  await db.prepare("SELECT pg_advisory_xact_lock(hashtext(?::text)) AS ok").get(`team:${hackathonId}:${username}`);
}

/**
 * Tira a pessoa do time dela na edição e avisa quem ficou. Chamado quando
 * ela sai, é removida por um colega, cancela a inscrição, é recusada ou
 * exclui a conta. Devolve o id do time (null se não tinha time).
 */
export async function leaveEditionTeam(
  hackathonId: string,
  username: string,
  how: { kind: "saiu" | "removido" | "sem_inscricao" | "conta_excluida"; by?: string },
): Promise<number | null> {
  return db.transaction(async () => {
    const team = await db
      .prepare(
        `SELECT t.id, t.name FROM teams t JOIN team_members tm ON tm.teamId = t.id
         WHERE t.hackathonId = ? AND tm.username = ? ORDER BY t.id LIMIT 1 FOR UPDATE OF t`,
      )
      .get<{ id: number; name: string }>(hackathonId, username);
    if (!team) return null;
    await db.prepare("DELETE FROM team_members WHERE teamId = ? AND username = ?").run(team.id, username);
    const text =
      how.kind === "removido"
        ? `@${how.by} tirou @${username} do time "${team.name}"`
        : how.kind === "sem_inscricao"
          ? `@${username} não tem mais inscrição nesta edição e saiu do time "${team.name}"`
          : how.kind === "conta_excluida"
            ? `um integrante excluiu a conta e saiu do time "${team.name}"`
            : `@${username} saiu do time "${team.name}"`;
    const stay = await db
      .prepare(
        `SELECT m.id FROM team_members tm JOIN members m ON m.username = tm.username
         WHERE tm.teamId = ? ORDER BY m.id`,
      )
      .all<{ id: number }>(team.id);
    for (const m of stay) {
      await notify(m.id, { type: "team_member_left", actorUsername: how.by, text, href: `/h/${hackathonId}#meu-time` });
    }
    if (stay.length === 0) await dropEmptyTeam(team.id);
    if (how.kind === "removido") {
      const gone = await db.prepare("SELECT id FROM members WHERE username = ?").get<{ id: number }>(username);
      if (gone) {
        await notify(gone.id, {
          type: "team_member_removed",
          actorUsername: how.by,
          text: `@${how.by} tirou você do time "${team.name}"`,
          href: `/h/${hackathonId}#meu-time`,
        });
      }
    }
    return team.id;
  })();
}

/**
 * Time que ficou sem ninguém e não deixou rastro na edição (versão enviada,
 * nota, voto, pódio, aviso, deploy) é apagado: some do arquivo, do júri e
 * da vitrine, e o nome fica livre de novo. Convites e desafios caem junto
 * (CASCADE). Com rastro, o time fica; o júri e a vitrine já deixam de fora
 * time enviado sem integrante (`ABANDONED_SQL` em lib/archive).
 */
async function dropEmptyTeam(teamId: number): Promise<void> {
  const clean = await db
    .prepare(
      `SELECT 1 AS ok FROM teams t
       WHERE t.id = ? AND t.placement = 0
         AND NOT EXISTS (SELECT 1 FROM team_members x WHERE x.teamId = t.id)
         AND NOT EXISTS (SELECT 1 FROM project_submissions x WHERE x.teamId = t.id)
         AND NOT EXISTS (SELECT 1 FROM scores x WHERE x.teamId = t.id)
         AND NOT EXISTS (SELECT 1 FROM votes x WHERE x.teamId = t.id)
         AND NOT EXISTS (SELECT 1 FROM live_votes x WHERE x.teamId = t.id)
         AND NOT EXISTS (SELECT 1 FROM prize_winners x WHERE x.teamId = t.id)
         AND NOT EXISTS (SELECT 1 FROM announcements x WHERE x.teamId = t.id)
         AND NOT EXISTS (SELECT 1 FROM deploys x WHERE x.teamId = t.id)`,
    )
    .get(teamId);
  if (!clean) return;
  await db.prepare("DELETE FROM team_projects WHERE teamId = ?").run(teamId);
  await db.prepare("DELETE FROM teams WHERE id = ?").run(teamId);
}

// depois da trava da entrega o time fica como foi enviado
async function assertTeamEditable(teamId: number): Promise<void> {
  try {
    await assertEvaluatedEditable(teamId);
  } catch (e) {
    if (e instanceof EntryError) throw new TeamError("a entrega já travou; fale com a organização pra mudar o time", 409);
    throw e;
  }
}

/** o próprio integrante sai do time (a inscrição continua) */
export async function leaveTeam(hackathonId: string, member: { id: number; username: string }): Promise<void> {
  const team = await memberTeamFor(hackathonId, member.username);
  if (!team) throw new TeamError("você não está em nenhum time nesta edição", 404);
  await assertTeamEditable(team.id);
  await leaveEditionTeam(hackathonId, member.username, { kind: "saiu" });
}

/**
 * Integrantes que um colega pode tirar do time: só quem está sem inscrição
 * aprovada na edição (cancelou, foi recusado, ficou na fila). Tirar alguém
 * aprovado é com a organização.
 */
export async function removableMembers(hackathonId: string, teamId: number): Promise<string[]> {
  const rows = await db
    .prepare(
      `SELECT tm.username FROM team_members tm
       LEFT JOIN members m ON m.username = tm.username
       LEFT JOIN registrations r ON r.memberId = m.id AND r.hackathonId = ?
       WHERE tm.teamId = ? AND (r.status IS NULL OR r.status <> 'approved')
       ORDER BY tm.username`,
    )
    .all<{ username: string }>(hackathonId, teamId);
  return rows.map((r) => r.username);
}

/** integrante tira do time um colega que está sem inscrição aprovada */
export async function removeTeamMember(
  hackathonId: string,
  actor: { username: string },
  rawTarget: unknown,
): Promise<ArchiveTeam> {
  const target = normUsername(rawTarget);
  if (!target) throw new TeamError("informe quem sai do time", 400);
  const team = await memberTeamFor(hackathonId, actor.username);
  if (!team) throw new TeamError("você não está em nenhum time nesta edição", 404);
  if (target === actor.username) throw new TeamError("pra sair do time, use \"sair do time\"", 400);
  if (!team.members.includes(target)) throw new TeamError(`@${target} não está no seu time`, 404);
  if (!(await removableMembers(hackathonId, team.id)).includes(target)) {
    throw new TeamError(`@${target} tem inscrição aprovada. Pra tirar @${target} do time, fale com a organização.`, 403);
  }
  await assertTeamEditable(team.id);
  await leaveEditionTeam(hackathonId, target, { kind: "removido", by: actor.username });
  return (await teamView("t.id = ?", team.id))!;
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

// spec 034 — prazo de formação de times (e entrega já travada) fecham a
// porta: criar time e aceitar convite passam por aqui
export async function assertFormationOpen(hackathonId: string): Promise<void> {
  const settings = await getSubmissionSettings(hackathonId);
  const formation = parseDbTime(settings?.teamFormationDeadline);
  if (formation && Date.now() > formation.getTime()) {
    throw new TeamError(`formação de times encerrada em ${formatBrt(settings!.teamFormationDeadline)}`, 409);
  }
  if (deadlinePassed(settings)) throw new TeamError("prazo de entrega encerrado", 409);
}

// o inscrito cria o time da edição — placement é SEMPRE 0: pódio é
// condecoração do organizador (admin), nunca autoatribuição. O autor
// entra automaticamente; colegas só entram se forem membros INSCRITOS
// na edição e ainda sem time — o resto volta em ignored, com o motivo.
// Frente N #4: colega não entra direto — recebe convite (notificação
// in-app) e só vira integrante quando aceita (lib/teamInvites).
export async function submitTeam(
  hackathonId: string,
  member: { username: string; id?: number },
  input: {
    name: string;
    memberUsernames?: string[];
    project?: ProjectInput | null;
  },
): Promise<{
  team: ArchiveTeam;
  ignoredUsernames: string[];
  ignored: IgnoredInvite[];
  invitedUsernames: string[];
}> {
  const name = String(input.name ?? "").trim();
  if (!name) throw new TeamError("nome do time obrigatório", 400);
  const project = validateProject(input.project);

  await assertFormationOpen(hackathonId);

  // colegas: normaliza/dedup, exige inscrição APROVADA na edição (spec 034:
  // integrante só aprovado) e nenhum time ainda
  const { ok: colegas, ignored } = await classifyInvitees(hackathonId, member.username, input.memberUsernames ?? []);

  const teamId = await db.transaction(async () => {
    await lockMemberInEdition(hackathonId, member.username);
    if (await memberTeamFor(hackathonId, member.username)) {
      throw new TeamError("você já tem time nesta edição", 409);
    }
    const nameTaken = await db
      .prepare("SELECT 1 FROM teams WHERE hackathonId = ? AND name = ?")
      .get(hackathonId, name);
    if (nameTaken) {
      throw new TeamError(`já existe um time "${name}" nesta edição`, 409);
    }
    const res = await db
      .prepare(
        "INSERT INTO teams (hackathonId, name, placement) VALUES (?, ?, 0)",
      )
      .run(hackathonId, name);
    const id = Number(res.lastInsertRowid);
    await db
      .prepare("INSERT OR IGNORE INTO team_members (teamId, username) VALUES (?, ?)")
      .run(id, member.username);
    if (project) {
      await db.prepare(
        `INSERT INTO team_projects (teamId, title, description, repoUrl, demoUrl, videoUrl, logoUrl)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        project.title,
        project.description,
        project.repoUrl,
        project.demoUrl,
        project.videoUrl,
        project.logoUrl,
      );
    }
    return id;
  })();
  // já tem time: o anúncio "procuro time" sai do ar
  const memberId =
    member.id ??
    (await db.prepare("SELECT id FROM members WHERE username = ?").get<{ id: number }>(member.username))?.id;
  if (memberId) await deactivateBoardEntry(memberId, hackathonId);
  const invitedUsernames = await createInvites(hackathonId, teamId, member.username, name, colegas);

  const team = await teamView("t.id = ?", teamId);
  if (!team) throw new TeamError("falha ao criar time", 500);
  return { team, ignoredUsernames: ignored.map((i) => i.username), ignored, invitedUsernames };
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
export async function updateTeamProject(
  teamId: number,
  member: { username: string },
  patch: ProjectPatch,
): Promise<ArchiveTeam> {
  const team = await db
    .prepare("SELECT id, hackathonId FROM teams WHERE id = ?")
    .get(teamId) as { id: number; hackathonId: string } | undefined;
  if (!team) throw new TeamError("time não encontrado", 404);

  const isMember = await db
    .prepare("SELECT 1 FROM team_members WHERE teamId = ? AND username = ?")
    .get(teamId, member.username);
  if (!isMember) throw new TeamError("só integrante edita o projeto", 403);
  // spec 034 — depois do prazo o projeto trava aqui também (senão este
  // PATCH antigo vira porta dos fundos da entrega)
  try {
    await assertEvaluatedEditable(teamId);
  } catch (e) {
    if (e instanceof EntryError) throw new TeamError(e.message, e.status);
    throw e;
  }

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

  const exists = await db
    .prepare("SELECT 1 FROM team_projects WHERE teamId = ?")
    .get(teamId);
  if (exists) {
    await db.prepare(
      `UPDATE team_projects SET ${fields.map((f) => `${f.col} = ?`).join(", ")}
       WHERE teamId = ?`,
    ).run(...fields.map((f) => f.value), teamId);
  } else {
    const get = (col: string) =>
      fields.find((f) => f.col === col)?.value ?? null;
    const title = get("title");
    if (!title) throw new TeamError("título do projeto obrigatório", 400);
    await db.prepare(
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

  return (await memberTeamFor(team.hackathonId, member.username))!;
}
