import db from "@/lib/db";
import { areaLabel, areasFromJson, isAreaKey, type AreaKey } from "@/lib/areas";
import { hiddenIdsFor, isBlockedEither } from "@/lib/blocks";
import { countFacts } from "@/lib/evidence";
import { parseEventTime } from "@/lib/eventTime";
import { getHackathon, isOver, isRegistrationClosed } from "@/lib/hackathons";
import { canNetwork } from "@/lib/network";
import { notify } from "@/lib/notifications";
import { inviteToTeam } from "@/lib/teamInvites";
import { memberTeamFor, submitTeam, TeamError } from "@/lib/teams";

// Vagas de time (spec 046, onda 3 — migration 045).
//
// O time abre vaga com área ("procuro design"), quem está sem time se
// candidata com uma intro curta, e o aceite do time vira CONVITE de time:
// inviteToTeam (lib/teamInvites) é quem convida, team_invites segue sendo o
// convite pendente e team_members só nasce no aceite do convidado. A vaga
// fica "preenchida" quando o convite é aceito, não quando o time aceita a
// candidatura — o convite pode ser recusado e aí a vaga volta a aceitar gente.
//
// CONTATO: o /u logado já mostra GitHub e LinkedIn de qualquer membro e esta
// feature não esconde isso. O que só aparece depois do aceite, pros dois
// lados, é o E-MAIL do perfil.
//
// O "bora fazer junto" (estudo 045, §Do encontro ao time) é um sinal mútuo e
// SILENCIOSO (team_up_signals): um sinal sozinho não notifica ninguém. Quando
// os dois marcam, o app chama o convite (um tem time), cria o time (nenhum
// tem) ou deixa a conexão (os dois já têm).

export const OPENING_INTRO_MAX = 280;
export const MAX_OPEN_OPENINGS = 3;

export type OpeningStatus = "aberta" | "preenchida" | "fechada";
export type ApplicationStatus = "enviada" | "aceita" | "recusada" | "retirada";

export type OpeningApplication = {
  id: number;
  username: string;
  name: string | null;
  headline: string | null;
  city: string | null;
  institution: string | null;
  helpOffer: AreaKey[];
  intro: string;
  status: ApplicationStatus;
  createdAt: string;
  respondedAt: string | null;
  /** só depois do aceite: o e-mail é o contato que o convite libera */
  email: string | null;
};

export type Opening = {
  id: number;
  teamId: number;
  teamName: string;
  hackathonId: string;
  hackathonName: string;
  area: AreaKey;
  intro: string;
  status: OpeningStatus;
  createdAt: string;
  /** @ de quem abriu (null quando a conta foi excluída) */
  creator: string | null;
  members: string[];
  isTeamMember: boolean;
  /** posso me candidatar agora (sem time na edição, sem bloqueio, vaga aberta) */
  canApply: boolean;
  /** minha candidatura, quando existe */
  mine: { id: number; status: ApplicationStatus; intro: string } | null;
  /** só pro time: quem se candidatou */
  applications: OpeningApplication[];
  /** só pro candidato aceito: e-mails do time */
  contactEmails: string[];
};

type Row = {
  id: number;
  teamId: number;
  teamName: string;
  hackathonId: string;
  hackathonName: string;
  area: string;
  intro: string;
  status: OpeningStatus;
  createdAt: string;
  creator: string | null;
};

const SELECT = `SELECT o.id, o."teamId", t.name AS "teamName", o."hackathonId",
       h.name AS "hackathonName", o.area, o.intro, o.status, o."createdAt",
       c.username AS "creator"
  FROM team_openings o
  JOIN teams t ON t.id = o."teamId"
  JOIN hackathons h ON h.id = o."hackathonId"
  LEFT JOIN members c ON c.id = o."createdBy"`;

type Viewer = { id: number; username: string };

type AppRow = {
  id: number;
  openingId: number;
  status: ApplicationStatus;
  intro: string;
  createdAt: string;
  respondedAt: string | null;
  username: string;
  name: string | null;
  headline: string | null;
  city: string | null;
  institution: string | null;
  helpOffer: string;
  email: string | null;
};

/** as linhas viram Opening com o que o viewer pode ver (sem N+1 por vaga) */
async function hydrate(rows: Row[], viewer: Viewer | null): Promise<Opening[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const teamIds = [...new Set(rows.map((r) => r.teamId))];
  const [teamRows, mineRows, regs, myTeams, hidden] = await Promise.all([
    db
      .prepare(
        `SELECT tm."teamId", tm.username, m.id AS "memberId"
         FROM team_members tm LEFT JOIN members m ON m.username = tm.username
         WHERE tm."teamId" = ANY(?::int[]) ORDER BY tm.username`,
      )
      .all<{ teamId: number; username: string; memberId: number | null }>(teamIds),
    viewer
      ? db
          .prepare(
            `SELECT id, "openingId", status, intro FROM opening_applications
             WHERE "memberId" = ? AND "openingId" = ANY(?::int[])`,
          )
          .all<{ id: number; openingId: number; status: ApplicationStatus; intro: string }>(viewer.id, ids)
      : Promise.resolve([] as { id: number; openingId: number; status: ApplicationStatus; intro: string }[]),
    viewer
      ? db
          .prepare(`SELECT "hackathonId" FROM registrations WHERE "memberId" = ? AND status = 'approved'`)
          .all<{ hackathonId: string }>(viewer.id)
      : Promise.resolve([] as { hackathonId: string }[]),
    viewer
      ? db
          .prepare(
            `SELECT t.id, t."hackathonId" FROM teams t
             JOIN team_members tm ON tm."teamId" = t.id WHERE tm.username = ?`,
          )
          .all<{ id: number; hackathonId: string }>(viewer.username)
      : Promise.resolve([] as { id: number; hackathonId: string }[]),
    viewer ? hiddenIdsFor(viewer.id) : Promise.resolve({ blocked: [] as number[], muted: [] as number[] }),
  ]);

  const approved = new Set(regs.map((r) => r.hackathonId));
  const myTeamByEdition = new Set(myTeams.map((t) => t.hackathonId));
  const blocked = new Set(hidden.blocked);
  const mineByOpening = new Map(mineRows.map((r) => [r.openingId, r]));

  // só o time da vaga vê as candidaturas
  const teamMemberOf = new Set<number>();
  const membersByTeam = new Map<number, string[]>();
  for (const r of teamRows) {
    membersByTeam.set(r.teamId, [...(membersByTeam.get(r.teamId) ?? []), r.username]);
  }
  for (const row of rows) {
    if (viewer && (membersByTeam.get(row.teamId) ?? []).includes(viewer.username)) {
      teamMemberOf.add(row.id);
    }
  }
  const visibleIds = rows.filter((r) => teamMemberOf.has(r.id)).map((r) => r.id);
  const acceptedTeamIds = rows
    .filter((r) => mineByOpening.get(r.id)?.status === "aceita")
    .map((r) => r.teamId);

  const [appRows, emailRows] = await Promise.all([
    visibleIds.length > 0
      ? db
          .prepare(
            `SELECT a.id, a."openingId", a.status, a.intro, a."createdAt", a."respondedAt",
                    m.username, m.name, m.headline, m.city, m.institution, m."helpOffer",
                    CASE WHEN a.status = 'aceita' THEN m.email END AS email
             FROM opening_applications a JOIN members m ON m.id = a."memberId"
             WHERE a."openingId" = ANY(?::int[]) AND a.status <> 'retirada'
               AND m.clerkId NOT LIKE 'deleted:%'
             ORDER BY a."createdAt", a.id`,
          )
          .all<AppRow>(visibleIds)
      : Promise.resolve([] as AppRow[]),
    acceptedTeamIds.length > 0
      ? db
          .prepare(
            `SELECT tm.username, m.email FROM team_members tm
             JOIN members m ON m.username = tm.username
             WHERE tm."teamId" = ANY(?::int[]) AND m.clerkId NOT LIKE 'deleted:%'
             ORDER BY tm.username`,
          )
          .all<{ username: string; email: string }>(acceptedTeamIds)
      : Promise.resolve([] as { username: string; email: string }[]),
  ]);

  return rows.map((row) => {
    const members = membersByTeam.get(row.teamId) ?? [];
    const isTeamMember = !!viewer && members.includes(viewer.username);
    const mine = mineByOpening.get(row.id);
    const teamBlocked = teamRows.some((t) => t.teamId === row.teamId && t.memberId !== null && blocked.has(t.memberId));
    const canApply =
      !!viewer &&
      !isTeamMember &&
      row.status === "aberta" &&
      approved.has(row.hackathonId) &&
      !myTeamByEdition.has(row.hackathonId) &&
      !teamBlocked;
    const contactEmails =
      mine?.status === "aceita"
        ? emailRows.filter((e) => members.includes(e.username)).map((e) => e.email)
        : [];
    return {
      id: row.id,
      teamId: row.teamId,
      teamName: row.teamName,
      hackathonId: row.hackathonId,
      hackathonName: row.hackathonName,
      area: (isAreaKey(row.area) ? row.area : "dev") as AreaKey,
      intro: row.intro,
      status: row.status,
      createdAt: row.createdAt,
      creator: row.creator,
      members,
      isTeamMember,
      canApply,
      mine: mine ? { id: mine.id, status: mine.status, intro: mine.intro } : null,
      applications: isTeamMember
        ? appRows
            .filter((a) => a.openingId === row.id)
            .map((a) => ({
              id: a.id,
              username: a.username,
              name: a.name,
              headline: a.headline,
              city: a.city,
              institution: a.institution,
              helpOffer: areasFromJson(a.helpOffer),
              intro: a.intro,
              status: a.status,
              createdAt: a.createdAt,
              respondedAt: a.respondedAt,
              email: a.status === "aceita" ? a.email : null,
            }))
        : [],
      contactEmails,
    };
  });
}

export type OpeningFilter = {
  hackathonId?: string | null;
  area?: AreaKey | null;
  cidade?: string | null;
  faculdade?: string | null;
  limit?: number;
  /**
   * inclui as vagas que não estão mais abertas mas são minhas: do meu time ou
   * com candidatura minha (a pessoa precisa ver o convite aceito e o e-mail).
   * Padrão true; as listas públicas passam false.
   */
  includeMine?: boolean;
};

/** vagas abertas, mais recentes primeiro; o viewer só vê o que é dele */
export async function listOpenings(
  filter: OpeningFilter,
  viewer: Viewer | null,
): Promise<Opening[]> {
  const mine =
    filter.includeMine === false
      ? ""
      : `OR EXISTS (SELECT 1 FROM team_members mtm
                     WHERE mtm."teamId" = o."teamId" AND mtm.username = @me::text)
         OR EXISTS (SELECT 1 FROM opening_applications ma
                     WHERE ma."openingId" = o.id AND ma."memberId" = @meid::int
                       AND ma.status IN ('enviada', 'aceita'))`;
  const rows = await db
    .prepare(
      `${SELECT}
       WHERE (o.status = 'aberta' ${mine})
         AND (@hid::text IS NULL OR o."hackathonId" = @hid::text)
         AND (@area::text IS NULL OR o.area = @area::text)
         AND (@cidade::text IS NULL OR EXISTS (
               SELECT 1 FROM team_members tm JOIN members mm ON mm.username = tm.username
               WHERE tm."teamId" = o."teamId" AND mm.city LIKE '%' || @cidade || '%'))
         AND (@faculdade::text IS NULL OR EXISTS (
               SELECT 1 FROM team_members tm JOIN members mm ON mm.username = tm.username
               WHERE tm."teamId" = o."teamId" AND mm.institution LIKE '%' || @faculdade || '%'))
       ORDER BY o."createdAt" DESC, o.id DESC
       LIMIT @limit`,
    )
    .all<Row>({
      hid: filter.hackathonId ?? null,
      area: filter.area ?? null,
      cidade: filter.cidade ?? null,
      faculdade: filter.faculdade ?? null,
      me: viewer?.username ?? null,
      meid: viewer?.id ?? null,
      limit: filter.limit ?? 60,
    });
  return hydrate(rows, viewer);
}

export async function getOpening(id: number, viewer: Viewer | null): Promise<Opening | null> {
  const row = await db.prepare(`${SELECT} WHERE o.id = ?`).get<Row>(id);
  if (!row) return null;
  return (await hydrate([row], viewer))[0] ?? null;
}

/** edições com vaga aberta ou gente procurando time (o filtro do /times) */
export async function activityEditions(): Promise<{ id: string; name: string }[]> {
  return db
    .prepare(
      `SELECT h.id, h.name FROM hackathons h
       WHERE h.active = 1 AND (
         EXISTS (SELECT 1 FROM team_openings o WHERE o."hackathonId" = h.id AND o.status = 'aberta')
         OR EXISTS (SELECT 1 FROM looking_for_team l WHERE l."hackathonId" = h.id AND l.active = 1))
       GROUP BY h.id, h.name, h."startsAt"
       ORDER BY h."startsAt" DESC`,
    )
    .all<{ id: string; name: string }>();
}

/** áreas que os times da pessoa procuram agora (alimenta o "pra você") */
export async function openAreasOfMyTeams(username: string): Promise<AreaKey[]> {
  const rows = await db
    .prepare(
      `SELECT DISTINCT o.area FROM team_openings o
       JOIN team_members tm ON tm."teamId" = o."teamId"
       WHERE tm.username = ? AND o.status = 'aberta'`,
    )
    .all<{ area: string }>(username);
  return rows.map((r) => r.area).filter(isAreaKey);
}

/** as vagas abertas do meu time na edição (o que o /times mostra pra editar) */
export async function myOpenings(teamId: number, viewer: Viewer): Promise<Opening[]> {
  const rows = await db
    .prepare(`${SELECT} WHERE o."teamId" = ? ORDER BY o."createdAt" DESC, o.id DESC`)
    .all<Row>(teamId);
  return hydrate(rows, viewer);
}

// ---------- regras ----------

const intro = (raw: unknown, what: string): string => {
  const t = typeof raw === "string" ? raw.trim() : "";
  if (!t) throw new TeamError(`escreva ${what}`, 400);
  if (t.length > OPENING_INTRO_MAX) {
    throw new TeamError(`${what} até ${OPENING_INTRO_MAX} caracteres`, 400);
  }
  return t;
};

/** a edição aceita formar time agora? (inscrição aberta ou evento rolando) */
async function assertEditionForming(hackathonId: string) {
  const h = await getHackathon(hackathonId);
  if (!h || !h.active) throw new TeamError("edição não encontrada", 404);
  if (isOver(h)) throw new TeamError("esta edição já terminou", 409);
  const started = (parseEventTime(h.startsAt)?.getTime() ?? 0) <= Date.now();
  if (!started && isRegistrationClosed(h)) {
    throw new TeamError("as inscrições desta edição fecharam", 409);
  }
  return h;
}

async function countOpen(teamId: number): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM team_openings WHERE \"teamId\" = ? AND status = 'aberta'")
    .get<{ n: number }>(teamId);
  return Number(row?.n ?? 0);
}

/** integrante do time abre vaga — até MAX_OPEN_OPENINGS abertas por time */
export async function createOpening(
  member: Viewer,
  input: { hackathonId?: unknown; area?: unknown; intro?: unknown },
): Promise<Opening> {
  const hackathonId = typeof input.hackathonId === "string" ? input.hackathonId.trim() : "";
  if (!hackathonId) throw new TeamError("diga a edição da vaga", 400);
  await assertEditionForming(hackathonId);
  if (!isAreaKey(input.area)) throw new TeamError("escolha a área da vaga", 400);
  const text = intro(input.intro, "o que você procura");
  const team = await memberTeamFor(hackathonId, member.username);
  if (!team) throw new TeamError("só quem tem time nesta edição abre vaga", 403);
  if ((await countOpen(team.id)) >= MAX_OPEN_OPENINGS) {
    throw new TeamError(`o time já tem ${MAX_OPEN_OPENINGS} vagas abertas`, 400);
  }
  const row = await db
    .prepare(
      `INSERT INTO team_openings ("teamId", "hackathonId", area, intro, "createdBy")
       VALUES (?, ?, ?, ?, ?) RETURNING id`,
    )
    .get<{ id: number }>(team.id, hackathonId, input.area, text, member.id);
  return (await getOpening(row!.id, member))!;
}

/** fecha a vaga sem preencher (o time desistiu de contratar) */
export async function closeOpening(member: Viewer, openingId: number): Promise<Opening> {
  const row = await db
    .prepare(`SELECT o.id, o."teamId", o.status FROM team_openings o WHERE o.id = ?`)
    .get<{ id: number; teamId: number; status: OpeningStatus }>(openingId);
  if (!row) throw new TeamError("vaga não encontrada", 404);
  const isMember = await db
    .prepare(`SELECT 1 AS ok FROM team_members WHERE "teamId" = ? AND username = ?`)
    .get(row.teamId, member.username);
  if (!isMember) throw new TeamError("vaga não encontrada", 404);
  if (row.status !== "aberta") throw new TeamError("essa vaga já foi fechada", 409);
  await db.prepare("UPDATE team_openings SET status = 'fechada' WHERE id = ?").run(openingId);
  return (await getOpening(openingId, member))!;
}

/**
 * Candidatura: inscrição aprovada na mesma edição, sem time, canNetwork e
 * nenhum bloqueio com integrante do time (bloqueio = 404 genérico, a pessoa
 * não fica sabendo). Recusada/retirada pode voltar; enviada/aceita não.
 */
export async function applyToOpening(
  member: Viewer,
  openingId: number,
  rawIntro: unknown,
): Promise<{ opening: Opening; applicationId: number }> {
  const text = intro(rawIntro, "sua intro");
  const row = await db
    .prepare(
      `SELECT o.id, o.status, o."hackathonId", o."teamId", o.area FROM team_openings o WHERE o.id = ?`,
    )
    .get<{ id: number; status: OpeningStatus; hackathonId: string; teamId: number; area: string }>(openingId);
  if (!row || row.status !== "aberta") throw new TeamError("vaga não encontrada", 404);

  const approved = await db
    .prepare(`SELECT 1 AS ok FROM registrations WHERE "memberId" = ? AND "hackathonId" = ? AND status = 'approved'`)
    .get(member.id, row.hackathonId);
  if (!approved) {
    throw new TeamError("só quem tem inscrição aprovada nesta edição se candidata", 403);
  }
  if (!(await canNetwork(member.id, row.hackathonId))) throw new TeamError("vaga não encontrada", 404);
  if (await memberTeamFor(row.hackathonId, member.username)) {
    throw new TeamError("você já tem time nesta edição", 409);
  }
  const teamMembers = await db
    .prepare(
      `SELECT m.id FROM team_members tm JOIN members m ON m.username = tm.username WHERE tm."teamId" = ?`,
    )
    .all<{ id: number }>(row.teamId);
  for (const t of teamMembers) {
    if (await isBlockedEither(member.id, t.id)) throw new TeamError("vaga não encontrada", 404);
  }

  const created = await db
    .prepare(
      `INSERT INTO opening_applications ("openingId", "memberId", intro)
       VALUES (?, ?, ?)
       ON CONFLICT ("openingId", "memberId") DO UPDATE
         SET intro = excluded.intro, status = 'enviada', "createdAt" = sqlite_now(), "respondedAt" = NULL
         WHERE opening_applications.status IN ('recusada', 'retirada')
       RETURNING id`,
    )
    .get<{ id: number }>(openingId, member.id, text);
  if (!created) throw new TeamError("você já se candidatou a esta vaga", 409);

  // o time inteiro fica sabendo (a vaga é do time, não de quem abriu)
  const team = await db
    .prepare(`SELECT name FROM teams WHERE id = ?`)
    .get<{ name: string }>(row.teamId);
  for (const t of teamMembers) {
    await notify(t.id, {
      type: "opening_application",
      actorId: member.id,
      actorUsername: member.username,
      text: `@${member.username} se candidatou à vaga de ${areaLabel(row.area) ?? row.area} do time "${team?.name ?? ""}"`,
      href: "/times?aba=vagas",
    });
  }
  return { opening: (await getOpening(openingId, member))!, applicationId: created.id };
}

type ApplicationRow = {
  id: number;
  openingId: number;
  status: ApplicationStatus;
  teamId: number;
  hackathonId: string;
  teamName: string;
  area: string;
  openingStatus: OpeningStatus;
  memberId: number;
  username: string;
};

/**
 * O time responde a candidatura. Aceitar chama inviteToTeam (o convite é
 * quem põe a pessoa no time) e marca a candidatura como aceita; a vaga só
 * vira "preenchida" quando o convite é aceito. Recusar avisa com frase
 * neutra, sem culpar ninguém.
 */
export async function respondApplication(
  member: Viewer,
  applicationId: number,
  action: "accept" | "decline",
): Promise<Opening> {
  const app = await db
    .prepare(
      `SELECT a.id, a."openingId", a.status, o."teamId", o."hackathonId", t.name AS "teamName", o.area,
              o.status AS "openingStatus", a."memberId", m.username
       FROM opening_applications a
       JOIN team_openings o ON o.id = a."openingId"
       JOIN teams t ON t.id = o."teamId"
       JOIN members m ON m.id = a."memberId"
       WHERE a.id = ?`,
    )
    .get<ApplicationRow>(applicationId);
  if (!app) throw new TeamError("candidatura não encontrada", 404);
  const isMember = await db
    .prepare(`SELECT 1 AS ok FROM team_members WHERE "teamId" = ? AND username = ?`)
    .get(app.teamId, member.username);
  if (!isMember) throw new TeamError("candidatura não encontrada", 404);
  if (app.status !== "enviada") throw new TeamError("essa candidatura já foi respondida", 409);

  if (action === "decline") {
    await db
      .prepare(
        `UPDATE opening_applications SET status = 'recusada', "respondedAt" = sqlite_now() WHERE id = ?`,
      )
      .run(app.id);
    await notify(app.memberId, {
      type: "opening_declined",
      actorId: member.id,
      actorUsername: member.username,
      text: `A vaga de ${areaLabel(app.area) ?? app.area} no time "${app.teamName}" foi preenchida de outro jeito.`,
      href: "/times?aba=vagas",
    });
  } else {
    if (app.openingStatus !== "aberta") throw new TeamError("essa vaga não está aberta", 409);
    const r = await inviteToTeam(app.hackathonId, { username: member.username }, [app.username]);
    if (r.invited.length === 0) {
      const reason = r.ignored[0]?.reason;
      throw new TeamError(
        reason === "ja_tem_time"
          ? "essa pessoa já entrou em um time nesta edição"
          : reason === "ja_convidado"
            ? "essa pessoa já tem convite pendente do time"
            : "não deu pra convidar essa pessoa agora",
        409,
      );
    }
    await db
      .prepare(
        `UPDATE opening_applications SET status = 'aceita', "respondedAt" = sqlite_now() WHERE id = ?`,
      )
      .run(app.id);
  }
  return (await getOpening(app.openingId, member))!;
}

/** convite de time aceito: a vaga que originou o convite fica preenchida */
export async function markOpeningFilledForInvite(teamId: number, memberId: number): Promise<void> {
  await db
    .prepare(
      `UPDATE team_openings SET status = 'preenchida'
       WHERE status = 'aberta' AND "teamId" = ?
         AND EXISTS (SELECT 1 FROM opening_applications a
                     WHERE a."openingId" = team_openings.id AND a."memberId" = ? AND a.status = 'aceita')`,
    )
    .run(teamId, memberId);
}

/** convite recusado: a candidatura vira retirada (a vaga segue aberta) */
export async function withdrawApplicationForDeclinedInvite(teamId: number, memberId: number): Promise<void> {
  await db
    .prepare(
      `UPDATE opening_applications SET status = 'retirada', "respondedAt" = sqlite_now()
       WHERE "memberId" = ? AND status = 'aceita'
         AND "openingId" IN (SELECT id FROM team_openings WHERE "teamId" = ?)`,
    )
    .run(memberId, teamId);
}

// ---------- compatibilidade em frases ----------

/**
 * Até 3 frases de compatibilidade entre a pessoa e a vaga — nunca nota
 * numérica, nunca ranking: a frase explica o porquê e a decisão é humana.
 */
export async function matchReasons(
  memberId: number,
  opening: { area: AreaKey; teamId: number; hackathonId: string },
): Promise<string[]> {
  const m = await db
    .prepare(`SELECT "helpOffer" FROM members WHERE id = ?`)
    .get<{ helpOffer: string }>(memberId);
  const offer = areasFromJson(m?.helpOffer);
  const out: string[] = [];
  const label = areaLabel(opening.area) ?? opening.area;
  if (offer.includes(opening.area)) out.push(`oferece ${label}, que é o que a vaga pede`);

  const shared = await db
    .prepare(
      `SELECT c.name FROM community_members eu
       JOIN community_members ela ON ela."communityId" = eu."communityId"
       JOIN members tm ON tm.id = ela."memberId"
       JOIN team_members tmx ON tmx.username = tm.username AND tmx."teamId" = ?
       JOIN communities c ON c.id = eu."communityId"
       WHERE eu."memberId" = ? AND c.hidden = 0
       ORDER BY c.name LIMIT 1`,
    )
    .get<{ name: string }>(opening.teamId, memberId);
  if (shared) out.push(`vocês são da mesma comunidade (${shared.name})`);

  const facts = await countFacts(memberId);
  if (facts.entrega === 1) out.push("já entregou 1 projeto");
  else if (facts.entrega > 1) out.push(`já entregou ${facts.entrega} projetos`);

  const same = await db
    .prepare(
      `SELECT h.name FROM team_members eu
       JOIN teams t1 ON t1.id = eu."teamId"
       JOIN team_members ela ON ela."teamId" = t1.id
       JOIN team_members tm ON tm.username = ela.username AND tm."teamId" = ?
       JOIN hackathons h ON h.id = t1."hackathonId"
       WHERE eu.username = (SELECT username FROM members WHERE id = ?)
       ORDER BY h."startsAt" DESC LIMIT 1`,
    )
    .get<{ name: string }>(opening.teamId, memberId);
  if (same) out.push(`vocês já fizeram time no ${same.name}`);

  return out.slice(0, 3);
}

// ---------- bora fazer junto (team_up_signals) ----------

export type TeamUpAction = "sinal" | "convite" | "time" | "conexao";

export type TeamUpResult = {
  mutual: boolean;
  action: TeamUpAction;
  teamId?: number;
};

/**
 * "Bora fazer junto" — sinal mútuo e silencioso. Um sinal sozinho não notifica
 * ninguém e a resposta não revela se a outra pessoa já marcou. Quando os dois
 * marcam na mesma edição: um tem time e o outro não → convite; nenhum tem →
 * o time nasce com os dois; os dois têm → fica a conexão.
 */
export async function signalTeamUp(
  member: Viewer,
  input: { username?: unknown; hackathonId?: unknown },
): Promise<TeamUpResult> {
  const username = String(input.username ?? "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
  const hackathonId = typeof input.hackathonId === "string" ? input.hackathonId.trim() : "";
  if (!username || username === member.username) {
    throw new TeamError("escolha outra pessoa pra marcar bora fazer junto", 400);
  }
  if (!hackathonId) throw new TeamError("diga a edição", 400);
  await assertEditionForming(hackathonId);

  const target = await db
    .prepare(`SELECT id, username FROM members WHERE username = ?`)
    .get<{ id: number; username: string }>(username);
  if (!target || target.id === member.id) throw new TeamError("pessoa não encontrada", 404);
  if (await isBlockedEither(member.id, target.id)) throw new TeamError("pessoa não encontrada", 404);
  if (!(await canNetwork(member.id, hackathonId)) || !(await canNetwork(target.id, hackathonId))) {
    throw new TeamError("pessoa não encontrada", 404);
  }
  const approved = await db
    .prepare(
      `SELECT "memberId" FROM registrations
       WHERE "hackathonId" = ? AND status = 'approved' AND "memberId" = ANY(?::int[])`,
    )
    .all<{ memberId: number }>(hackathonId, [member.id, target.id]);
  if (approved.length < 2) {
    throw new TeamError("os dois precisam ter inscrição aprovada nesta edição", 403);
  }

  await db
    .prepare(
      `INSERT OR IGNORE INTO team_up_signals ("memberId", "peerId", "hackathonId") VALUES (?, ?, ?)`,
    )
    .run(member.id, target.id, hackathonId);
  const back = await db
    .prepare(
      `SELECT 1 AS ok FROM team_up_signals WHERE "memberId" = ? AND "peerId" = ? AND "hackathonId" = ?`,
    )
    .get(target.id, member.id, hackathonId);
  if (!back) return { mutual: false, action: "sinal" };

  const [mine, theirs] = await Promise.all([
    memberTeamFor(hackathonId, member.username),
    memberTeamFor(hackathonId, target.username),
  ]);
  const href = "/times?aba=procurando";

  if (mine && !theirs) {
    const r = await inviteToTeam(hackathonId, { username: member.username }, [target.username]);
    if (r.invited.length > 0) return { mutual: true, action: "convite", teamId: mine.id };
  } else if (!mine && !theirs) {
    try {
      const r = await submitTeam(hackathonId, member, {
        name: `Time de @${member.username} e @${target.username}`,
        memberUsernames: [target.username],
      });
      return { mutual: true, action: "time", teamId: r.team.id };
    } catch (e) {
      if (!(e instanceof TeamError)) throw e;
      // nome já em uso ou formação fechada: fica a conexão, sem prometer time
    }
  }

  // os dois já têm time (ou o convite não passou): a conexão fica registrada
  await notify(target.id, {
    type: "team_up",
    actorId: member.id,
    actorUsername: member.username,
    text: `@${member.username} também marcou bora fazer junto com você`,
    href,
  });
  return { mutual: true, action: "conexao" };
}
