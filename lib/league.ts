import db from "@/lib/db";
import { hiddenIdsFor } from "@/lib/blocks";
import { countFacts, eligibleEditionsSql } from "@/lib/evidence";
import { spParts, spWallTime } from "@/lib/eventTime";
import { FACT_XP, factLabel } from "@/lib/game";
import { columnExists, relationExists } from "@/lib/metrics";
import { canNetwork } from "@/lib/network";

// Liga do semestre por faixa (spec 046, onda 5: liga-por-faixa, migration 054).
//
// Regra de ranking justo (spec 043, "Ranking justo"): mostra FAIXA, nunca
// posição numérica ("#847"), compara a pessoa com ela mesma (este semestre x
// o passado) e a lista de nomes só existe pra quem ativou o opt-in. Sem
// rebaixamento: a faixa é uma foto do semestre e não cai quando a pessoa some.
//
// Os pontos saem dos fatos de lib/evidence.ts, com o mesmo recorte de edição
// elegível (15 check-ins, comunidade verificada, organizador fora da própria
// edição). Presença sozinha não pontua — o que conta é o que ficou pronto:
//   entrega travada 60 · prêmio 100 · semana do "4 semanas" 15
//
// A feature entra DESLIGADA (HACKAHUB_LIGA_ON): /liga dá 404 e o link não
// aparece. O fundador liga depois de conversar com 5 organizadores (040 #21).

export const LIGA_FLAG = "HACKAHUB_LIGA_ON";

/** a liga está ligada neste ambiente? (desligada por padrão) */
export function ligaEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[LIGA_FLAG] === "on";
}

// ---------- semestre (a "temporada" da spec 043) ----------

export type Semester = {
  /** "2026-1" (mar–jul) ou "2026-2" (ago–dez) */
  key: string;
  /** "mar–jul 2026" */
  label: string;
  /** início, instante UTC */
  start: Date;
  /** fim exclusivo, instante UTC */
  end: Date;
};

const build = (year: number, firstMonth: number, label: string, half: 1 | 2): Semester => ({
  key: `${year}-${half}`,
  label: `${label} ${year}`,
  start: spWallTime(year, firstMonth, 1),
  // fim exclusivo: 1º dia do mês seguinte, 00:00 em Brasília
  end: spWallTime(year, firstMonth + 5, 1),
});

/**
 * Semestre letivo em Brasília: mar–jul e ago–dez (spec 043). Janeiro e
 * fevereiro são recesso e ficam com o semestre que acabou (ago–dez do ano
 * anterior): a faixa continua visível até a temporada nova começar em 1º de
 * março, em vez de a página abrir vazia por dois meses.
 */
export function semester(now: Date = new Date()): Semester {
  const { y, m } = spParts(now);
  if (m >= 3 && m <= 7) return build(y, 3, "mar–jul", 1);
  return build(m <= 2 ? y - 1 : y, 8, "ago–dez", 2);
}

/** o semestre anterior (o "passado" da comparação) */
export function previousSemester(sem: Semester): Semester {
  return semester(new Date(sem.start.getTime() - 86_400_000));
}

/** janela de fatos do semestre (fim inclusivo, no último segundo) */
export function semesterWindow(sem: Semester): { since: Date; until: Date } {
  return { since: sem.start, until: new Date(sem.end.getTime() - 1000) };
}

// ---------- pontos ----------

/** semana cumprida do "4 semanas" (migration 052) */
export const WEEK_POINTS = 15;

export type LeaguePoints = { points: number; entrega: number; premio: number; semanas: number };

/** tabela do "4 semanas" pode não existir (feature da mesma onda, branch paralela) */
let weeksReady: boolean | null = null;
async function weeksTableReady(): Promise<boolean> {
  if (weeksReady === null) {
    weeksReady =
      (await relationExists("follow_through_weeks")) &&
      (await columnExists("follow_through_weeks", "markedAt"));
  }
  return weeksReady;
}

const params = (sem: Semester) => {
  const w = semesterWindow(sem);
  return { since: w.since.toISOString(), until: w.until.toISOString() };
};

// O organizador da edição não pontua nela — mesma regra de notOrganizer em
// lib/evidence.ts, aqui por linha (memberCol) porque a conta é de todo mundo
// numa query só. tests/unit/league.test.ts confere que a conta em lote bate
// com countFacts, pra as duas não descolarem.
const notOrganizerSql = (hackathonCol: string, memberCol: string) => `NOT EXISTS (
      SELECT 1 FROM edition_roles ev_o
       WHERE ev_o.hackathonId = ${hackathonCol} AND ev_o.memberId = ${memberCol} AND ev_o.role = 'organizador')
    AND NOT EXISTS (
      SELECT 1 FROM edition_role_revocations ev_rv
       WHERE ev_rv.hackathonId = ${hackathonCol} AND ev_rv.memberId = ${memberCol} AND ev_rv.role = 'organizador')`;

type CountRow = { memberId: number; n: number };

/** entregas travadas por membro no semestre (1 por time) */
async function entregaCounts(sem: Semester): Promise<CountRow[]> {
  return db
    .prepare(
      `WITH ent AS (
         SELECT mm.id AS "memberId", t.id AS "teamId", MAX(ps.submittedAt) AS "at"
         FROM teams t
         JOIN team_members tm ON tm.teamId = t.id
         JOIN members mm ON mm.username = tm.username
         JOIN project_submissions ps ON ps.teamId = t.id
         JOIN hackathons h ON h.id = t.hackathonId
         WHERE t.hackathonId IN (${eligibleEditionsSql})
           AND ${notOrganizerSql("t.hackathonId", "mm.id")}
           AND (
             (to_ts(h.submissionDeadline) + make_interval(mins => h.submissionGraceMinutes) < now()
               AND COALESCE(to_ts(t.reopenedUntil) <= now(), true))
             OR to_ts(COALESCE(h.endsAt, h.registrationDeadline, h.startsAt)) < now()
           )
         GROUP BY mm.id, t.id
       )
       SELECT "memberId", COUNT(*)::int AS "n" FROM ent
        WHERE to_ts("at") >= @since::timestamptz AND to_ts("at") <= @until::timestamptz
        GROUP BY "memberId"`,
    )
    .all<CountRow>(params(sem));
}

/** prêmios por membro no semestre (1 por categoria) */
async function premioCounts(sem: Semester): Promise<CountRow[]> {
  return db
    .prepare(
      `SELECT mm.id AS "memberId", COUNT(*)::int AS "n"
       FROM prize_winners pw
       JOIN prize_categories pc ON pc.id = pw.categoryId
       JOIN teams t ON t.id = pw.teamId AND t.hackathonId = pc.hackathonId
       JOIN team_members tm ON tm.teamId = t.id
       JOIN members mm ON mm.username = tm.username
       WHERE pc.hackathonId IN (${eligibleEditionsSql})
         AND ${notOrganizerSql("pc.hackathonId", "mm.id")}
         AND to_ts(pw.createdAt) >= @since::timestamptz AND to_ts(pw.createdAt) <= @until::timestamptz
       GROUP BY mm.id`,
    )
    .all<CountRow>(params(sem));
}

/** semanas do "4 semanas" cumpridas por membro no semestre (0 sem a migration 052) */
async function semanaCounts(sem: Semester): Promise<CountRow[]> {
  if (!(await weeksTableReady())) return [];
  return db
    .prepare(
      `SELECT mm.id AS "memberId", COUNT(*)::int AS "n"
       FROM follow_through_weeks w
       JOIN team_members tm ON tm.teamId = w.teamId
       JOIN members mm ON mm.username = tm.username
       WHERE to_ts(w.markedAt) >= @since::timestamptz AND to_ts(w.markedAt) <= @until::timestamptz
       GROUP BY mm.id`,
    )
    .all<CountRow>(params(sem));
}

/**
 * Pontos de todos os membros com ponto no semestre (id → pontos), numa ida ao
 * banco por tipo de fato. A faixa precisa da distribuição inteira: ranking por
 * faixa sem saber quem mais pontua não existe.
 */
export async function leagueDistribution(sem: Semester): Promise<Map<number, number>> {
  const [ent, prem, sem_] = await Promise.all([entregaCounts(sem), premioCounts(sem), semanaCounts(sem)]);
  const out = new Map<number, number>();
  const add = (rows: CountRow[], xp: number) => {
    for (const r of rows) {
      const id = Number(r.memberId);
      out.set(id, (out.get(id) ?? 0) + Number(r.n) * xp);
    }
  };
  add(ent, FACT_XP.entrega.xp);
  add(prem, FACT_XP.premio.xp);
  add(sem_, WEEK_POINTS);
  return out;
}

/** os pontos da própria pessoa, pelos fatos (countFacts), no semestre */
export async function leaguePoints(memberId: number, sem: Semester): Promise<LeaguePoints> {
  const w = semesterWindow(sem);
  const [counts, semanas] = await Promise.all([
    countFacts(memberId, { since: w.since, until: w.until }),
    weeksTableReady().then(async (ok) => {
      if (!ok) return 0;
      const row = await db
        .prepare(
          `SELECT COUNT(*)::int AS "n"
           FROM follow_through_weeks w
           JOIN team_members tm ON tm.teamId = w.teamId
           JOIN members mm ON mm.username = tm.username
           WHERE mm.id = @m
             AND to_ts(w.markedAt) >= @since::timestamptz AND to_ts(w.markedAt) <= @until::timestamptz`,
        )
        .get<{ n: number }>({ ...params(sem), m: memberId });
      return Number(row?.n ?? 0);
    }),
  ]);
  const entrega = counts.entrega;
  const premio = counts.premio;
  return {
    points: entrega * FACT_XP.entrega.xp + premio * FACT_XP.premio.xp + semanas * WEEK_POINTS,
    entrega,
    premio,
    semanas,
  };
}

/** "2 entregas travadas", "1 prêmio", "4 semanas de acompanhamento" */
export function leagueBreakdown(p: LeaguePoints): { label: string; points: number }[] {
  const out: { label: string; points: number }[] = [];
  if (p.entrega > 0) out.push({ label: factLabel("entrega", p.entrega), points: p.entrega * FACT_XP.entrega.xp });
  if (p.premio > 0) out.push({ label: factLabel("premio", p.premio), points: p.premio * FACT_XP.premio.xp });
  if (p.semanas > 0)
    out.push({
      label: p.semanas === 1 ? "1 semana de acompanhamento" : `${p.semanas} semanas de acompanhamento`,
      points: p.semanas * WEEK_POINTS,
    });
  return out;
}

// ---------- faixa ----------

export const LEAGUE_BANDS = ["top 10%", "top 25%", "top 50%", "começando"] as const;
export type LeagueBand = (typeof LEAGUE_BANDS)[number];

/** faixa a partir da posição (1 = primeiro) entre quem tem ponto no semestre */
function bandFromRank(points: number, rank: number, total: number): LeagueBand {
  if (points <= 0) return "começando";
  if (rank <= Math.ceil(total * 0.1)) return "top 10%";
  if (rank <= Math.ceil(total * 0.25)) return "top 25%";
  if (rank <= Math.ceil(total * 0.5)) return "top 50%";
  // metade de baixo com ponto também é "começando": a liga não expõe cauda
  return "começando";
}

/**
 * A faixa de quem tem `points`, contra os pontos das OUTRAS pessoas com ponto
 * no semestre. A posição numérica morre aqui: pra fora só sai a faixa.
 */
export function bandFor(points: number, others: number[]): LeagueBand {
  const rank = 1 + others.filter((p) => p > points).length;
  return bandFromRank(points, rank, 1 + others.filter((p) => p > 0).length);
}

/** faixa de cada pessoa da distribuição (id → faixa), pra lista opt-in */
export function bandMap(dist: Map<number, number>): Map<number, LeagueBand> {
  const positive = [...dist.values()].filter((p) => p > 0);
  const out = new Map<number, LeagueBand>();
  for (const [id, points] of dist) {
    out.set(id, bandFromRank(points, 1 + positive.filter((p) => p > points).length, positive.length));
  }
  return out;
}

export type LeagueStanding = {
  sem: Semester;
  points: number;
  breakdown: LeaguePoints;
  band: LeagueBand;
  /** quantas pessoas têm ponto no semestre (nunca a posição de quem lê) */
  peers: number;
};

/** a faixa da pessoa no semestre: pontos, quebra e contra quantas pessoas */
export async function leagueStanding(memberId: number, sem: Semester): Promise<LeagueStanding> {
  const [breakdown, dist] = await Promise.all([leaguePoints(memberId, sem), leagueDistribution(sem)]);
  const others = [...dist.entries()].filter(([id]) => id !== memberId).map(([, p]) => p);
  const peers = [...dist.values()].filter((p) => p > 0).length + (dist.has(memberId) || breakdown.points === 0 ? 0 : 1);
  return { sem, points: breakdown.points, breakdown, band: bandFor(breakdown.points, others), peers };
}

// ---------- lista opt-in ----------

export const LEAGUE_LIST_MAX = 50;

export type LeagueRow = {
  id: number;
  username: string;
  name: string | null;
  avatarUrl: string | null;
  band: LeagueBand;
};

/**
 * Quem também está na liga: só membros com leagueOptIn = 1 e ponto no
 * semestre, até LEAGUE_LIST_MAX. Filtro opcional por comunidade. Quem lê não
 * vê quem o bloqueou/silenciou nem quem não passa em canNetwork.
 */
export async function rankingOptIn(
  sem: Semester,
  opts: { communityId?: number | null; viewerId?: number | null } = {},
): Promise<LeagueRow[]> {
  const dist = await leagueDistribution(sem);
  if (!dist.size) return [];
  const community = opts.communityId ?? null;
  const rows = await db
    .prepare(
      `SELECT m.id AS "id", m.username AS "username", m.name AS "name", m.avatarUrl AS "avatarUrl"
       FROM members m
       WHERE m.leagueOptIn = 1 AND m.clerkId NOT LIKE 'deleted:%'
       ${community === null ? "" : `AND EXISTS (SELECT 1 FROM community_members cm
             WHERE cm.communityId = @c AND cm.memberId = m.id)`}`,
    )
    .all<{ id: number; username: string; name: string | null; avatarUrl: string | null }>(
      community === null ? {} : { c: community },
    );
  const points = (id: number) => dist.get(Number(id)) ?? 0;
  const sorted = rows
    .filter((r) => points(r.id) > 0)
    .sort((a, b) => points(b.id) - points(a.id) || a.username.localeCompare(b.username));
  let visible = sorted;
  if (opts.viewerId) {
    const hidden = await hiddenIdsFor(opts.viewerId);
    const out = new Set([...hidden.blocked, ...hidden.muted]);
    visible = sorted.filter((r) => !out.has(Number(r.id)));
  }
  const head = visible.slice(0, LEAGUE_LIST_MAX);
  const bands = bandMap(dist);
  const ok = await Promise.all(
    head.map(async (r) => ((await canNetwork(Number(r.id))) ? r : null)),
  );
  return ok
    .filter((r): r is NonNullable<typeof r> => r !== null)
    .map((r) => ({
      id: Number(r.id),
      username: r.username,
      name: r.name,
      avatarUrl: r.avatarUrl,
      band: bands.get(Number(r.id)) ?? "começando",
    }));
}

// ---------- opt-in ----------

export async function leagueOptIn(memberId: number): Promise<boolean> {
  const row = await db
    .prepare("SELECT leagueOptIn AS \"v\" FROM members WHERE id = ?")
    .get<{ v: number }>(memberId);
  return Number(row?.v ?? 0) === 1;
}

/** liga/desliga a própria presença na lista; devolve o estado gravado */
export async function setLeagueOptIn(memberId: number, on: boolean): Promise<boolean> {
  await db.prepare("UPDATE members SET leagueOptIn = ? WHERE id = ?").run(on ? 1 : 0, memberId);
  return leagueOptIn(memberId);
}

// ---------- copy ----------

/** "Você está no top 25% da liga." — nunca uma posição */
export function bandSentence(band: LeagueBand, points = 0): string {
  if (band !== "começando") return `Você está no ${band} da liga.`;
  // "começando" é a temporada sem ponto e também a metade de baixo com ponto:
  // a liga não expõe a cauda, então a frase não fala de lugar nenhum
  return points > 0 ? "Você está começando a subir na liga." : "Você está começando nesta temporada.";
}
