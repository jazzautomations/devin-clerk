import db from "@/lib/db";
import { notify } from "@/lib/notifications";
import { deactivateBoardEntry } from "@/lib/teamboard";
import { assertFormationOpen, lockMemberInEdition, memberTeamFor, TeamError } from "@/lib/teams";

// Frente N #4 — aceite de membro de time (migration 016). Pôr alguém num
// time sem perguntar era o furo apontado no QA: o nome da pessoa ia pro
// arquivo, pro certificado e pro voto sem ela saber. Agora quem está no
// time convida; o convidado aceita ou recusa por uma notificação in-app, e
// só no aceite nasce a linha de team_members. team_members continua
// significando "está no time" — os membros que já existiam seguem aceitos.

export type InviteStatus = "pending" | "accepted" | "declined" | "cancelled";

/** quem não recebeu convite, e por quê (a tela mostra o motivo de cada um) */
export type IgnoredInvite = {
  username: string;
  reason: "nao_existe" | "nao_aprovado" | "ja_tem_time" | "ja_convidado";
};

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
      text: `@${inviterUsername} convidou você pro time "${teamName}". Aceite ou recuse na página da edição.`,
      href: inviteHref(hackathonId),
    });
  }
  return invited;
}

/**
 * Separa quem pode receber convite (membro com inscrição APROVADA na edição e
 * ainda sem time) de quem não pode, com o motivo. Normaliza "@Fulano" e tira
 * repetidos e o próprio autor.
 */
export async function classifyInvitees(
  hackathonId: string,
  inviterUsername: string,
  raw: unknown[],
): Promise<{ ok: string[]; ignored: IgnoredInvite[] }> {
  const ok: string[] = [];
  const ignored: IgnoredInvite[] = [];
  const seen = new Set<string>([inviterUsername]);
  for (const r of raw) {
    const username = normUsername(r);
    if (!username || seen.has(username)) continue;
    seen.add(username);
    const row = await db
      .prepare(
        `SELECT m.id, r.status FROM members m
         LEFT JOIN registrations r ON r.memberId = m.id AND r.hackathonId = ?
         WHERE m.username = ?`,
      )
      .get<{ id: number; status: string | null }>(hackathonId, username);
    if (!row) ignored.push({ username, reason: "nao_existe" });
    else if (row.status !== "approved") ignored.push({ username, reason: "nao_aprovado" });
    else if (await memberTeamFor(hackathonId, username)) ignored.push({ username, reason: "ja_tem_time" });
    else ok.push(username);
  }
  return { ok, ignored };
}

/**
 * Integrante convida mais gente pro próprio time. Mesmas regras do
 * submitTeam (classifyInvitees); quem já tinha convite pendente volta como
 * ja_convidado.
 */
export async function inviteToTeam(
  hackathonId: string,
  inviter: { username: string },
  rawUsernames: unknown[],
): Promise<{ invited: string[]; ignored: IgnoredInvite[] }> {
  const team = await memberTeamFor(hackathonId, inviter.username);
  if (!team) throw new TeamError("você ainda não tem time nesta edição", 404);
  await assertFormationOpen(hackathonId);
  const { ok, ignored } = await classifyInvitees(hackathonId, inviter.username, rawUsernames);
  if (ok.length === 0 && ignored.length === 0) throw new TeamError("informe ao menos um username", 400);
  const invited = await createInvites(hackathonId, team.id, inviter.username, team.name, ok);
  for (const u of ok) {
    if (!invited.includes(u)) ignored.push({ username: u, reason: "ja_convidado" });
  }
  return { invited, ignored };
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
    if (!approved) throw new TeamError("só quem tem inscrição aprovada entra em time", 403);
    await lockMemberInEdition(inv.hackathonId, member.username);
    if (await memberTeamFor(inv.hackathonId, member.username)) {
      throw new TeamError("você já tem time nesta edição", 409);
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
    // achou time: o anúncio "procuro time" sai do ar
    await deactivateBoardEntry(member.id, inv.hackathonId);
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
