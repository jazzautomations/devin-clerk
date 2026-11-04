import db from "@/lib/db";
import { parseDbDate } from "@/lib/buildWeeks";
import { editionEnd } from "@/lib/continuity";
import { parseEventTime, spParts } from "@/lib/eventTime";
import { toDbTime } from "@/lib/entries";
import { notify } from "@/lib/notifications";
import { canManageEdition } from "@/lib/roles";

// 4 semanas depois (spec 046, onda 5, migration 052).
//
// O projeto vivo da Onda 3 é a base: a atualização semanal JÁ é o post do
// diário (posts.teamId, lib/projectUpdates.ts) — aqui não existe tabela de
// texto, só a contagem de qual semana o time cumpriu. Seguir projeto
// (project_follows) e o diário continuam donos do conteúdo.
//
// Regras que valem no produto inteiro:
// - o nome não é "temporada" (a 043 usa temporada pra semestre);
// - nada de sequência que zera e nada de aviso de streak: semana vazia não
//   apaga nada, e o lembrete de quinta é UM lembrete por semana;
// - a grade times × semanas é do time e de quem organiza a edição
//   (spec 040 #15). Quem é de fora vê só o agregado;
// - o selo 'quatro-semanas' (lib/game.ts) é concedido pelo cron, com
//   INSERT ... ON CONFLICT DO NOTHING, e não dá XP (o plano 046 proíbe).

const DAY = 86_400_000;
const WEEK = 7 * DAY;

/** período padrão: as 4 semanas do Colosseum Eternal */
export const DEFAULT_WEEKS = 4;
export const MIN_WEEKS = 2;
export const MAX_WEEKS = 8;
/** dá pra abrir até 30 dias depois do fim da edição */
export const OPEN_AFTER_END_DAYS = 30;
/** o período começa hoje ou nos próximos 14 dias (nada de agendar meses) */
export const START_AHEAD_DAYS = 14;
/** entrar (time) até o fim da semana 1 */
export const JOIN_BY_WEEK = 1;
/** lembrete semanal: quinta-feira, no horário de Brasília (0 = domingo) */
export const REMINDER_WEEKDAY = 4;
/** motivo gravado quando o período termina sozinho */
export const CLOSED_BY_PERIOD = "fim das semanas";
export const REASON_MAX = 200;

export const FOUR_WEEKS_BADGE = "quatro-semanas";

export type FollowThroughRow = {
  hackathonId: string;
  startsAt: string;
  weeks: number;
  demoMeetupId: number | null;
  createdBy: number | null;
  createdAt: string;
  closedAt: string | null;
  closedReason: string | null;
};

export type Phase = "antes" | "durante" | "depois";

export class FollowThroughFailure extends Error {
  status: 400 | 403 | 404 | 409;
  constructor(message: string, status: 400 | 403 | 404 | 409) {
    super(message);
    this.status = status;
  }
}

type Actor = { id: number; role: string };

// ---------- janelas (puro) ----------

export type WeekWindow = { week: number; from: Date; to: Date };

/** janela [from, to) da semana `week` (1-based) */
export function weekWindow(startsAt: Date, week: number): WeekWindow {
  const from = new Date(startsAt.getTime() + (week - 1) * WEEK);
  return { week, from, to: new Date(from.getTime() + WEEK) };
}

export function weekWindows(startsAt: Date, weeks: number): WeekWindow[] {
  return Array.from({ length: weeks }, (_, i) => weekWindow(startsAt, i + 1));
}

/** fim do período (exclusivo): começo da semana seguinte à última */
export function periodEnd(startsAt: Date, weeks: number): Date {
  return new Date(startsAt.getTime() + weeks * WEEK);
}

/** em que semana caiu `at`? null quando está fora do período */
export function weekOfPost(startsAt: Date, weeks: number, at: Date): number | null {
  const diff = at.getTime() - startsAt.getTime();
  if (diff < 0) return null;
  const week = Math.floor(diff / WEEK) + 1;
  return week >= 1 && week <= weeks ? week : null;
}

export function phaseOf(ft: { startsAt: string; weeks: number }, now: Date): Phase {
  const starts = parseDbDate(ft.startsAt);
  if (!starts) return "antes";
  if (now.getTime() < starts.getTime()) return "antes";
  return now.getTime() >= periodEnd(starts, ft.weeks).getTime() ? "depois" : "durante";
}

/** dia da semana em Brasília (0 = domingo) — o lembrete é de quinta */
export function brtWeekday(now: Date): number {
  const p = spParts(now);
  return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay();
}

const dayFmt = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "America/Sao_Paulo",
});

/** "14/11" — data de parede em Brasília */
export function dayLabel(d: Date): string {
  return dayFmt.format(d);
}

/** "14/11 a 12/12" — o período inteiro, em Brasília */
export function periodLabel(startsAt: Date, weeks: number): string {
  return `${dayLabel(startsAt)} a ${dayLabel(new Date(periodEnd(startsAt, weeks).getTime() - DAY))}`;
}

// ---------- abrir ----------

export type OpenInput = { startsAt: Date; weeks: number; demoMeetupId: number | null };

/**
 * O que a API aceita ao abrir. `startsAt` é opcional (padrão: o fim da
 * edição, ou agora se a edição já acabou) e precisa cair entre ontem e 14
 * dias à frente. Puro: `now` e `end` vêm de fora.
 */
export function parseOpenInput(
  input: unknown,
  opts: { now: Date; end: Date | null },
): { value: OpenInput } | { error: string } {
  const b = (input ?? {}) as Record<string, unknown>;
  const rawWeeks = b.weeks === undefined || b.weeks === null || b.weeks === "" ? DEFAULT_WEEKS : Number(b.weeks);
  if (!Number.isInteger(rawWeeks) || rawWeeks < MIN_WEEKS || rawWeeks > MAX_WEEKS) {
    return { error: `De ${MIN_WEEKS} a ${MAX_WEEKS} semanas.` };
  }
  let demoMeetupId: number | null = null;
  if (b.demoMeetupId !== undefined && b.demoMeetupId !== null && b.demoMeetupId !== "") {
    const n = Number(b.demoMeetupId);
    if (!Number.isSafeInteger(n) || n <= 0) return { error: "Demo day inválido." };
    demoMeetupId = n;
  }
  const fallback = opts.end && opts.end.getTime() > opts.now.getTime() ? opts.end : opts.now;
  let startsAt = fallback;
  if (typeof b.startsAt === "string" && b.startsAt.trim()) {
    const parsed = parseEventTime(b.startsAt);
    if (!parsed) return { error: "Data de início inválida." };
    startsAt = parsed;
  }
  if (startsAt.getTime() < opts.now.getTime() - DAY) {
    return { error: "As 4 semanas começam hoje ou depois." };
  }
  if (startsAt.getTime() > opts.now.getTime() + START_AHEAD_DAYS * DAY) {
    return { error: `As 4 semanas começam em até ${START_AHEAD_DAYS} dias.` };
  }
  return { value: { startsAt, weeks: rawWeeks, demoMeetupId } };
}

/** título do demo day de fechamento (meetups, 051) — sem FK, pode ter sumido */
export async function demoMeetupTitle(meetupId: number): Promise<string | null> {
  const row = await db.prepare("SELECT title FROM meetups WHERE id = ?").get<{ title: string }>(meetupId);
  return row?.title ?? null;
}

export async function getFollowThrough(hackathonId: string): Promise<FollowThroughRow | null> {
  const row = await db
    .prepare(
      `SELECT hackathonId, startsAt, weeks, demoMeetupId, createdBy, createdAt, closedAt, closedReason
       FROM follow_through WHERE hackathonId = ?`,
    )
    .get<FollowThroughRow>(hackathonId);
  return row ? { ...row, weeks: Number(row.weeks), demoMeetupId: row.demoMeetupId === null ? null : Number(row.demoMeetupId) } : null;
}

type EditionRow = { id: string; endsAt: string | null; submissionDeadline: string | null };

export async function openFollowThrough(
  actor: Actor | null,
  hackathonId: string,
  input: unknown,
  now: Date = new Date(),
): Promise<FollowThroughRow> {
  if (!(await canManageEdition(actor, hackathonId))) {
    throw new FollowThroughFailure("Só quem organiza a edição abre as 4 semanas.", 403);
  }
  const h = await db
    .prepare("SELECT id, endsAt, submissionDeadline FROM hackathons WHERE id = ?")
    .get<EditionRow>(hackathonId);
  if (!h) throw new FollowThroughFailure("Edição não encontrada.", 404);
  const end = editionEnd(h);
  if (!end) throw new FollowThroughFailure("A edição ainda não tem data de fim.", 400);
  if (now.getTime() > end.getTime() + OPEN_AFTER_END_DAYS * DAY) {
    throw new FollowThroughFailure(`As 4 semanas abrem até ${OPEN_AFTER_END_DAYS} dias depois do fim da edição.`, 400);
  }
  const parsed = parseOpenInput(input, { now, end });
  if ("error" in parsed) throw new FollowThroughFailure(parsed.error, 400);
  if (await getFollowThrough(hackathonId)) {
    throw new FollowThroughFailure("As 4 semanas já estão abertas.", 409);
  }
  const { startsAt, weeks, demoMeetupId } = parsed.value;
  if (demoMeetupId !== null) {
    const meetup = await db.prepare("SELECT 1 AS ok FROM meetups WHERE id = ?").get(demoMeetupId);
    if (!meetup) throw new FollowThroughFailure("Demo day não encontrado.", 400);
  }
  await db
    .prepare(`INSERT INTO follow_through (hackathonId, startsAt, weeks, demoMeetupId, createdBy) VALUES (?, ?, ?, ?, ?)`)
    .run(hackathonId, toDbTime(startsAt), weeks, demoMeetupId, actor!.id);
  const row = await getFollowThrough(hackathonId);
  if (!row) throw new FollowThroughFailure("Não deu pra abrir as 4 semanas.", 400);
  return row;
}

/** encerrar antes do prazo: motivo obrigatório (é o que o time lê) */
export async function closeFollowThrough(
  actor: Actor | null,
  hackathonId: string,
  reason: unknown,
  now: Date = new Date(),
): Promise<FollowThroughRow> {
  if (!(await canManageEdition(actor, hackathonId))) {
    throw new FollowThroughFailure("Só quem organiza a edição encerra as 4 semanas.", 403);
  }
  const ft = await getFollowThrough(hackathonId);
  if (!ft) throw new FollowThroughFailure("As 4 semanas não estão abertas.", 404);
  if (ft.closedAt) throw new FollowThroughFailure("As 4 semanas já estão encerradas.", 409);
  const text = typeof reason === "string" ? reason.trim() : "";
  if (text.length < 3) throw new FollowThroughFailure("Escreva o motivo do encerramento.", 400);
  if (text.length > REASON_MAX) throw new FollowThroughFailure(`Motivo até ${REASON_MAX} caracteres.`, 400);
  await db
    .prepare("UPDATE follow_through SET closedAt = ?, closedReason = ? WHERE hackathonId = ?")
    .run(toDbTime(now), text, hackathonId);
  return (await getFollowThrough(hackathonId))!;
}

// ---------- entrar ----------

export type JoinResult = { joined: boolean; teamName: string };

/** quem é do time, pelos @s de team_members */
async function teamMemberIds(teamId: number): Promise<number[]> {
  const rows = await db
    .prepare(
      `SELECT m.id FROM team_members tm JOIN members m ON m.username = tm.username
       WHERE tm.teamId = ? AND m.clerkId NOT LIKE 'deleted:%' ORDER BY m.id`,
    )
    .all<{ id: number }>(teamId);
  return rows.map((r) => Number(r.id));
}

export async function joinFollowThrough(
  member: { id: number; username: string },
  hackathonId: string,
  teamId: number,
  now: Date = new Date(),
): Promise<JoinResult> {
  const ft = await getFollowThrough(hackathonId);
  if (!ft) throw new FollowThroughFailure("As 4 semanas não estão abertas.", 404);
  if (ft.closedAt) throw new FollowThroughFailure("As 4 semanas já encerraram.", 409);
  const starts = parseDbDate(ft.startsAt);
  if (!starts) throw new FollowThroughFailure("As 4 semanas não estão abertas.", 404);
  if (now.getTime() >= periodEnd(starts, JOIN_BY_WEEK).getTime()) {
    throw new FollowThroughFailure("Entrar vale até o fim da primeira semana.", 400);
  }
  const team = await db
    .prepare("SELECT id, name FROM teams WHERE id = ? AND hackathonId = ?")
    .get<{ id: number; name: string }>(teamId, hackathonId);
  if (!team) throw new FollowThroughFailure("Time não encontrado nesta edição.", 404);
  const mine = await db
    .prepare("SELECT 1 AS ok FROM team_members WHERE teamId = ? AND username = ?")
    .get(teamId, member.username);
  if (!mine) throw new FollowThroughFailure("Só quem está no time entra por ele.", 403);
  const delivered = await db
    .prepare("SELECT 1 AS ok FROM project_submissions WHERE teamId = ? LIMIT 1")
    .get(teamId);
  if (!delivered) throw new FollowThroughFailure("Só time que entregou projeto na edição entra.", 400);
  const r = await db
    .prepare("INSERT INTO follow_through_teams (hackathonId, teamId) VALUES (?, ?) ON CONFLICT DO NOTHING")
    .run(hackathonId, teamId);
  if (r.changes === 0) return { joined: false, teamName: team.name };
  const href = `/h/${hackathonId}/quatro-semanas`;
  for (const id of await teamMemberIds(teamId)) {
    await notify(id, {
      type: "follow_through_join",
      actorId: member.id,
      text: `${team.name} entrou nas 4 semanas depois.`,
      href,
    });
  }
  return { joined: true, teamName: team.name };
}

// ---------- a grade ----------

export type GridTeam = {
  teamId: number;
  teamName: string;
  projectTitle: string | null;
  joinedAt: string;
  /** postId de cada semana (1..weeks); null = semana sem atualização */
  weeks: (number | null)[];
  done: number;
  complete: boolean;
};

export type FollowThroughGrid = {
  followThrough: FollowThroughRow;
  phase: Phase;
  /** semana em curso (1..weeks) ou null fora do período */
  currentWeek: number | null;
  teams: GridTeam[];
  aggregate: { teams: number; postedThisWeek: number; completed: number };
};

/**
 * A grade times × semanas, lida ao vivo: semana N conta se existir post do
 * time com createdAt na janela dela (o cron materializa a mesma coisa em
 * follow_through_weeks). O post da semana é o primeiro dela.
 */
export async function followThroughGrid(ft: FollowThroughRow, now: Date = new Date()): Promise<FollowThroughGrid> {
  const starts = parseDbDate(ft.startsAt) ?? now;
  const [teams, posts] = await Promise.all([
    db
      .prepare(
        `SELECT ft.teamId, t.name AS teamName, tp.title AS projectTitle, ft.joinedAt
         FROM follow_through_teams ft
         JOIN teams t ON t.id = ft.teamId
         LEFT JOIN team_projects tp ON tp.teamId = ft.teamId
         WHERE ft.hackathonId = ?
         ORDER BY t.name`,
      )
      .all<{ teamId: number; teamName: string; projectTitle: string | null; joinedAt: string }>(ft.hackathonId),
    db
      .prepare(
        `SELECT p.id, p.teamId, p.createdAt FROM posts p
         JOIN follow_through_teams ft ON ft.teamId = p.teamId AND ft.hackathonId = ?
         WHERE p.teamId IS NOT NULL
         ORDER BY p.id`,
      )
      .all<{ id: number; teamId: number; createdAt: string }>(ft.hackathonId),
  ]);

  const byTeam = new Map<number, (number | null)[]>();
  for (const t of teams) byTeam.set(Number(t.teamId), Array.from({ length: ft.weeks }, () => null));
  for (const p of posts) {
    const at = parseDbDate(p.createdAt);
    const week = at ? weekOfPost(starts, ft.weeks, at) : null;
    if (week === null) continue;
    const slots = byTeam.get(Number(p.teamId));
    if (!slots) continue;
    if (slots[week - 1] === null) slots[week - 1] = Number(p.id);
  }

  const phase = phaseOf(ft, now);
  const currentWeek = phase === "durante" ? weekOfPost(starts, ft.weeks, now) : null;
  const rows: GridTeam[] = teams.map((t) => {
    const weeks = byTeam.get(Number(t.teamId)) ?? [];
    const done = weeks.filter((w) => w !== null).length;
    return {
      teamId: Number(t.teamId),
      teamName: t.teamName,
      projectTitle: t.projectTitle,
      joinedAt: t.joinedAt,
      weeks,
      done,
      complete: ft.weeks > 0 && done === ft.weeks,
    };
  });

  return {
    followThrough: ft,
    phase,
    currentWeek,
    teams: rows,
    aggregate: {
      teams: rows.length,
      postedThisWeek: currentWeek === null ? 0 : rows.filter((r) => r.weeks[currentWeek - 1] !== null).length,
      completed: rows.filter((r) => r.complete).length,
    },
  };
}

export type MyTeam = { teamId: number; name: string; joined: boolean; canJoin: boolean };

/**
 * Os times da pessoa nesta edição: os que já entraram e os que ainda podem
 * entrar (time com entrega, dentro da semana 1 e período aberto).
 */
export async function myFollowThroughTeams(
  hackathonId: string,
  username: string,
  ft: FollowThroughRow,
  now: Date = new Date(),
): Promise<MyTeam[]> {
  const starts = parseDbDate(ft.startsAt);
  const open = !ft.closedAt && !!starts && now.getTime() < periodEnd(starts, JOIN_BY_WEEK).getTime();
  const rows = await db
    .prepare(
      `SELECT t.id AS teamId, t.name,
              EXISTS (SELECT 1 FROM follow_through_teams x WHERE x.hackathonId = ? AND x.teamId = t.id) AS joined,
              EXISTS (SELECT 1 FROM project_submissions ps WHERE ps.teamId = t.id) AS delivered
       FROM teams t
       JOIN team_members tm ON tm.teamId = t.id
       WHERE t.hackathonId = ? AND tm.username = ?
       ORDER BY t.name`,
    )
    .all<{ teamId: number; name: string; joined: number; delivered: number }>(hackathonId, hackathonId, username);
  return rows.map((r) => {
    const joined = Number(r.joined) === 1;
    return {
      teamId: Number(r.teamId),
      name: r.name,
      joined,
      canJoin: !joined && open && Number(r.delivered) === 1,
    };
  });
}

/**
 * A grade por time é privada do time e de quem organiza a edição (spec 040
 * #15). Membro de time inscrito vê a grade inteira; qualquer outra pessoa vê
 * só o agregado.
 */
export async function canSeeFollowThroughGrid(
  actor: Actor | null,
  hackathonId: string,
): Promise<boolean> {
  if (!actor) return false;
  if (await canManageEdition(actor, hackathonId)) return true;
  const me = await db
    .prepare(
      `SELECT 1 AS ok FROM follow_through_teams ft
       JOIN team_members tm ON tm.teamId = ft.teamId
       JOIN members m ON m.username = tm.username
       WHERE ft.hackathonId = ? AND m.id = ? LIMIT 1`,
    )
    .get(hackathonId, actor.id);
  return !!me;
}

// ---------- cron ----------

export type CronResult = {
  editions: number;
  weeks: number;
  reminders: number;
  badges: number;
  closed: number;
};

/**
 * Cron diário (POST /api/cron/quatro-semanas, deploy/quatro-semanas.sh):
 * 1. materializa em follow_through_weeks uma linha por time e semana já
 *    começada (postId = primeiro post do time na janela, ou NULL);
 * 2. na quinta (Brasília), lembra UMA vez o time que ainda não postou a
 *    semana em curso (remindedAt) — lembrete sem culpa, sem streak;
 * 3. quando o período acaba, concede o selo 'quatro-semanas' a quem tem todas
 *    as semanas, avisa e fecha o período.
 * Idempotente: rodar de novo no mesmo dia não duplica nada.
 */
export async function runFollowThrough(now: Date = new Date()): Promise<CronResult> {
  const out: CronResult = { editions: 0, weeks: 0, reminders: 0, badges: 0, closed: 0 };
  const all = await db
    .prepare(
      `SELECT hackathonId, startsAt, weeks, demoMeetupId, createdBy, createdAt, closedAt, closedReason
       FROM follow_through ORDER BY startsAt`,
    )
    .all<FollowThroughRow>();

  for (const raw of all) {
    const ft: FollowThroughRow = { ...raw, weeks: Number(raw.weeks) };
    const starts = parseDbDate(ft.startsAt);
    if (!starts) continue;
    const end = periodEnd(starts, ft.weeks);
    if (now.getTime() < starts.getTime()) continue;
    out.editions++;

    const teams = await db
      .prepare("SELECT teamId FROM follow_through_teams WHERE hackathonId = ? ORDER BY teamId")
      .all<{ teamId: number }>(ft.hackathonId);
    if (teams.length === 0) {
      // ninguém entrou: não há o que materializar; o período ainda fecha
      if (!ft.closedAt && now.getTime() >= end.getTime()) {
        await closeAtEnd(ft.hackathonId, now);
        out.closed++;
      }
      continue;
    }

    // 1. materializa as semanas que já começaram
    const posts = await db
      .prepare(
        `SELECT p.id, p.teamId, p.createdAt FROM posts p
         JOIN follow_through_teams ft ON ft.teamId = p.teamId AND ft.hackathonId = ?
         WHERE p.teamId IS NOT NULL ORDER BY p.id`,
      )
      .all<{ id: number; teamId: number; createdAt: string }>(ft.hackathonId);
    const started = weekWindows(starts, ft.weeks).filter((w) => w.from.getTime() <= now.getTime());
    const first = new Map<string, number>();
    for (const p of posts) {
      const at = parseDbDate(p.createdAt);
      const week = at ? weekOfPost(starts, ft.weeks, at) : null;
      if (week === null) continue;
      const key = `${p.teamId}:${week}`;
      if (!first.has(key)) first.set(key, Number(p.id));
    }
    for (const team of teams) {
      for (const w of started) {
        const postId = first.get(`${team.teamId}:${w.week}`) ?? null;
        const r = await db
          .prepare(
            `INSERT INTO follow_through_weeks (hackathonId, teamId, week, postId, markedAt)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (hackathonId, teamId, week) DO UPDATE
               SET postId = COALESCE(follow_through_weeks.postId, EXCLUDED.postId),
                   markedAt = COALESCE(follow_through_weeks.markedAt, EXCLUDED.markedAt)`,
          )
          .run(ft.hackathonId, team.teamId, w.week, postId, postId === null ? null : toDbTime(now));
        if (r.changes > 0) out.weeks++;
      }
    }

    if (ft.closedAt) continue;

    // 2. lembrete de quinta, uma vez por semana por time
    const currentWeek = weekOfPost(starts, ft.weeks, now);
    if (currentWeek !== null && brtWeekday(now) === REMINDER_WEEKDAY) {
      const missing = await db
        .prepare(
          `SELECT teamId FROM follow_through_weeks
           WHERE hackathonId = ? AND week = ? AND postId IS NULL AND remindedAt IS NULL`,
        )
        .all<{ teamId: number }>(ft.hackathonId, currentWeek);
      for (const row of missing) {
        await db
          .prepare(
            "UPDATE follow_through_weeks SET remindedAt = ? WHERE hackathonId = ? AND teamId = ? AND week = ? AND remindedAt IS NULL",
          )
          .run(toDbTime(now), ft.hackathonId, row.teamId, currentWeek);
        const href = `/h/${ft.hackathonId}/quatro-semanas`;
        for (const id of await teamMemberIds(Number(row.teamId))) {
          await notify(id, {
            type: "follow_through_reminder",
            text: `Semana ${currentWeek} de ${ft.weeks}: o diário do time ainda não tem a atualização desta semana. Dá tempo até domingo.`,
            href,
          });
        }
        out.reminders++;
      }
    }

    // 3. fim do período: selo pra quem fechou todas as semanas
    if (now.getTime() >= end.getTime()) {
      const complete = await db
        .prepare(
          `SELECT teamId FROM follow_through_weeks
           WHERE hackathonId = ? AND postId IS NOT NULL
           GROUP BY teamId HAVING COUNT(*) >= ?`,
        )
        .all<{ teamId: number }>(ft.hackathonId, ft.weeks);
      for (const row of complete) {
        for (const id of await teamMemberIds(Number(row.teamId))) {
          const r = await db
            .prepare(`INSERT INTO member_badges (memberId, badgeId) VALUES (?, ?) ON CONFLICT DO NOTHING`)
            .run(id, FOUR_WEEKS_BADGE);
          if (r.changes === 0) continue;
          out.badges++;
          await notify(id, {
            type: "follow_through_badge",
            text: `Seu time fechou as ${ft.weeks} semanas depois do evento: o selo quatro semanas está no seu perfil.`,
            href: "/perfil",
          });
        }
      }
      await closeAtEnd(ft.hackathonId, now);
      out.closed++;
    }
  }
  return out;
}

async function closeAtEnd(hackathonId: string, now: Date): Promise<void> {
  await db
    .prepare("UPDATE follow_through SET closedAt = ?, closedReason = ? WHERE hackathonId = ? AND closedAt IS NULL")
    .run(toDbTime(now), CLOSED_BY_PERIOD, hackathonId);
}
