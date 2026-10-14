import db from "@/lib/db";
import { notify } from "@/lib/notifications";
import { assertFormationOpen, memberTeamFor, TeamError } from "@/lib/teams";

// Frente N #4 — aceite de membro de time (migration 016). Pôr alguém num
// time sem perguntar era o furo apontado no QA: o nome da pessoa ia pro
// arquivo, pro certificado e pro voto sem ela saber. Agora quem está no
// time convida; o convidado aceita ou recusa por uma notificação in-app, e
// só no aceite nasce a linha de team_members. team_members continua
// significando "está no time" — os membros que já existiam seguem aceitos.

export type InviteStatus = "pending" | "accepted" | "declined" | "cancelled";

export type MyInvite = {
  id: number;
  teamId: number;
  teamName: string;
  hackathonId: string;
  invitedBy: string | null;
  createdAt: string;
};

const normUsername = (u: unknown) =>
  String(u ?? "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();

const inviteHref = (hackathonId: string) => `/h/${hackathonId}#meu-time`;

/**
 * Cria (ou reabre, se tinha sido recusado/cancelado) o convite de cada
 * username — já validados pelo chamador — e notifica. Devolve quem foi
 * convidado de fato (convite pendente repetido não notifica de novo).
 */
export async function createInvites(
  hackathonId: string,
  teamId: number,
  inviterUsername: string,
  teamName: string,
  usernames: string[],
): Promise<string[]> {
  if (usernames.length === 0) return [];
  const inviter = await db
    .prepare("SELECT id FROM members WHERE username = ?")
    .get<{ id: number }>(inviterUsername);
  const invited: string[] = [];
  for (const username of usernames) {
    const m = await db.prepare("SELECT id FROM members WHERE username = ?").get<{ id: number }>(username);
    if (!m) continue;
    const row = await db
      .prepare(
        `INSERT INTO team_invites (teamId, hackathonId, memberId, invitedBy)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (teamId, memberId) DO UPDATE
           SET status = 'pending', invitedBy = excluded.invitedBy,
               createdAt = sqlite_now(), respondedAt = NULL
           WHERE team_invites.status <> 'pending'
         RETURNING id`,
      )
      .get<{ id: number }>(teamId, hackathonId, m.id, inviter?.id ?? null);
    if (!row) continue; // já tinha convite pendente — sem spam
    invited.push(username);
    await notify(m.id, {
      type: "team_invite",
      actorUsername: inviterUsername,
      text: `@${inviterUsername} te convidou pro time "${teamName}" — aceita ou recusa na página da edição`,
      href: inviteHref(hackathonId),
    });
  }
  return invited;
}

/**
 * Integrante convida mais gente pro próprio time. Mesmas regras do
 * submitTeam: só inscrito APROVADO na edição e ainda sem time; o resto
 * volta em ignored.
 */
export async function inviteToTeam(
  hackathonId: string,
  inviter: { username: string },
  rawUsernames: unknown[],
): Promise<{ invited: string[]; ignored: string[] }> {
  const team = await memberTeamFor(hackathonId, inviter.username);
  if (!team) throw new TeamError("tu ainda não tens time nesta edição", 404);
  await assertFormationOpen(hackathonId);
  const ok: string[] = [];
  const ignored: string[] = [];
  for (const raw of rawUsernames) {
    const username = normUsername(raw);
    if (!username || username === inviter.username || ok.includes(username) || ignored.includes(username)) continue;
    const registered = await db
      .prepare(
        `SELECT 1 FROM registrations r JOIN members m ON m.id = r.memberId
         WHERE r.hackathonId = ? AND m.username = ? AND r.status = 'approved'`,
      )
      .get(hackathonId, username);
    if (registered && !(await memberTeamFor(hackathonId, username))) ok.push(username);
    else ignored.push(username);
  }
  if (ok.length === 0 && ignored.length === 0) throw new TeamError("informe ao menos um username", 400);
  const invited = await createInvites(hackathonId, team.id, inviter.username, team.name, ok);
  return { invited, ignored: [...ignored, ...ok.filter((u) => !invited.includes(u))] };
}

/** convites pendentes do membro na edição (o que aparece no "meu time") */
export async function listMyInvites(memberId: number, hackathonId: string): Promise<MyInvite[]> {
  return db
    .prepare(
      `SELECT i.id, i.teamId, t.name AS "teamName", i.hackathonId, m.username AS "invitedBy", i.createdAt
       FROM team_invites i
       JOIN teams t ON t.id = i.teamId
       LEFT JOIN members m ON m.id = i.invitedBy
       WHERE i.memberId = ? AND i.hackathonId = ? AND i.status = 'pending'
       ORDER BY i.id`,
    )
    .all<MyInvite>(memberId, hackathonId);
}

/** quem o time convidou e ainda não respondeu */
export async function listPendingTeamInvites(teamId: number): Promise<string[]> {
  const rows = await db
    .prepare(
      `SELECT m.username FROM team_invites i JOIN members m ON m.id = i.memberId
       WHERE i.teamId = ? AND i.status = 'pending' ORDER BY m.username`,
    )
    .all<{ username: string }>(teamId);
  return rows.map((r) => r.username);
}

/**
 * Convidado responde. accept: precisa seguir aprovado, sem time e com a
 * formação aberta; entra no time, os outros convites dele na edição caem
 * (cancelled) e quem convidou é avisado. decline: só marca e avisa.
 * Convite de outra pessoa / inexistente = 404; já respondido = 409.
 */
export async function respondInvite(
  inviteId: number,
  member: { id: number; username: string },
  action: "accept" | "decline",
  hackathonId?: string,
): Promise<{ status: InviteStatus; teamId: number; hackathonId: string }> {
  return db.transaction(async () => {
    const inv = await db
      .prepare(
        `SELECT i.id, i.teamId, i.hackathonId, i.status, i.invitedBy, t.name AS "teamName"
         FROM team_invites i JOIN teams t ON t.id = i.teamId
         WHERE i.id = ? AND i.memberId = ? AND (?::text IS NULL OR i.hackathonId = ?::text)
         FOR UPDATE OF i`,
      )
      .get<{
        id: number;
        teamId: number;
        hackathonId: string;
        status: InviteStatus;
        invitedBy: number | null;
        teamName: string;
      }>(inviteId, member.id, hackathonId ?? null, hackathonId ?? null);
    if (!inv) throw new TeamError("convite não encontrado", 404);
    if (inv.status !== "pending") throw new TeamError("convite já respondido", 409);

    if (action === "decline") {
      await db
        .prepare("UPDATE team_invites SET status = 'declined', respondedAt = sqlite_now() WHERE id = ?")
        .run(inv.id);
      if (inv.invitedBy) {
        await notify(inv.invitedBy, {
          type: "team_invite_declined",
          actorUsername: member.username,
          text: `@${member.username} recusou o convite pro time "${inv.teamName}"`,
          href: inviteHref(inv.hackathonId),
        });
      }
      return { status: "declined" as const, teamId: inv.teamId, hackathonId: inv.hackathonId };
    }

    const approved = await db
      .prepare("SELECT 1 FROM registrations WHERE memberId = ? AND hackathonId = ? AND status = 'approved'")
      .get(member.id, inv.hackathonId);
    if (!approved) throw new TeamError("só inscrito aprovado entra em time", 403);
    if (await memberTeamFor(inv.hackathonId, member.username)) {
      throw new TeamError("tu já tens time nesta edição", 409);
    }
    await assertFormationOpen(inv.hackathonId);
    await db
      .prepare("INSERT OR IGNORE INTO team_members (teamId, username) VALUES (?, ?)")
      .run(inv.teamId, member.username);
    await db
      .prepare("UPDATE team_invites SET status = 'accepted', respondedAt = sqlite_now() WHERE id = ?")
      .run(inv.id);
    // um membro = um time por edição: os outros convites caem
    await db
      .prepare(
        `UPDATE team_invites SET status = 'cancelled', respondedAt = sqlite_now()
         WHERE memberId = ? AND hackathonId = ? AND status = 'pending' AND id <> ?`,
      )
      .run(member.id, inv.hackathonId, inv.id);
    if (inv.invitedBy) {
      await notify(inv.invitedBy, {
        type: "team_invite_accepted",
        actorUsername: member.username,
        text: `@${member.username} aceitou e entrou no time "${inv.teamName}"`,
        href: inviteHref(inv.hackathonId),
      });
    }
    return { status: "accepted" as const, teamId: inv.teamId, hackathonId: inv.hackathonId };
  })();
}
