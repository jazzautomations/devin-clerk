import db from "@/lib/db";

// Modo palco (spec 033, frente F — specs/033-hackinova-ops/palco.md): a
// final ao vivo. O organizador/staff opera do celular (fila, cronômetro,
// votação), o telão mostra, o público vota 1–5 no pitch que está no palco.
//
// Tudo vem do banco (migration 009). Nenhum estado do palco vive em memória
// do processo: restart no meio da final não perde nada. O stream SSE
// (lib/stageStream) só reparte o mesmo snapshot entre conexões.
//
// Por que nota 1–5 e não estrela simples: com "curti/não curti" o placar
// mede quanta gente estava na sala naquele pitch (o primeiro time pega a
// plateia chegando, o último pega a plateia indo embora), não a qualidade.
// Com nota, o ranking é pela MÉDIA — cada pitch é julgado por quem o viu,
// e a quantidade de votos aparece do lado como contexto.

export class StageError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export type StageStatus = "idle" | "live" | "ended";

type SessionRow = {
  hackathonId: string;
  status: StageStatus;
  currentTeamId: number | null;
  pitchSeconds: number;
  pitchStartedAt: string | null;
  pitchElapsedMs: number;
  votingOpen: number;
  updatedAt: string;
};

export type StageSession = {
  hackathonId: string;
  status: StageStatus;
  currentTeamId: number | null;
  pitchSeconds: number;
  pitchStartedAt: string | null;
  pitchElapsedMs: number;
  votingOpen: boolean;
};

export type StageTeam = {
  teamId: number;
  teamName: string;
  title: string;
  logoUrl: string | null;
  members: string[];
};

export type Tally = { count: number; sum: number; avg: number | null; dist: number[] };

export type RankingEntry = {
  teamId: number;
  teamName: string;
  title: string;
  logoUrl: string | null;
  votes: number;
  sum: number;
  avg: number | null;
  position: number;
  tied: boolean;
};

export type StageSnapshot = {
  hackathonId: string;
  status: StageStatus;
  current: (StageTeam & { position: number }) | null;
  total: number;
  upNext: { teamId: number; teamName: string; title: string }[];
  timer: {
    pitchSeconds: number;
    running: boolean;
    startedAt: string | null;
    elapsedMs: number;
    remainingMs: number;
  };
  votingOpen: boolean;
  tally: Tally | null;
  /** só aparece com a final encerrada — o suspense do resultado é parte do show */
  ranking: RankingEntry[] | null;
  serverNow: string;
};

export const PITCH_MIN = 30;
export const PITCH_MAX = 1800;

const DEFAULT_SESSION = (hackathonId: string): StageSession => ({
  hackathonId,
  status: "idle",
  currentTeamId: null,
  pitchSeconds: 180,
  pitchStartedAt: null,
  pitchElapsedMs: 0,
  votingOpen: false,
});

// datas com milissegundo — o cronômetro pausa/retoma várias vezes e
// truncar no segundo acumularia erro a cada retomada
export function stamp(d: Date): string {
  return d.toISOString().replace("T", " ").replace("Z", "");
}
export function parseStamp(s: string): Date {
  return new Date(s.replace(" ", "T") + "Z");
}

function toSession(r: SessionRow): StageSession {
  return {
    hackathonId: r.hackathonId,
    status: r.status,
    currentTeamId: r.currentTeamId,
    pitchSeconds: Number(r.pitchSeconds),
    pitchStartedAt: r.pitchStartedAt,
    pitchElapsedMs: Number(r.pitchElapsedMs),
    votingOpen: Number(r.votingOpen) === 1,
  };
}

export async function getSession(hackathonId: string): Promise<StageSession> {
  const row = await db
    .prepare("SELECT * FROM stage_sessions WHERE hackathonId = ?")
    .get<SessionRow>(hackathonId);
  return row ? toSession(row) : DEFAULT_SESSION(hackathonId);
}

/**
 * Roda uma mutação do palco com a linha da sessão travada (FOR UPDATE):
 * dois celulares apertando "próximo" juntos não pulam dois pitches.
 */
async function mutate(
  hackathonId: string,
  fn: (s: StageSession) => Promise<Partial<StageSession> | null> | Partial<StageSession> | null,
): Promise<StageSession> {
  return db.transaction(async () => {
    await db
      .prepare("INSERT INTO stage_sessions (hackathonId) VALUES (?) ON CONFLICT (hackathonId) DO NOTHING")
      .run(hackathonId);
    const row = await db
      .prepare("SELECT * FROM stage_sessions WHERE hackathonId = ? FOR UPDATE")
      .get<SessionRow>(hackathonId);
    const s = toSession(row!);
    const patch = await fn(s);
    if (!patch) return s;
    const next = { ...s, ...patch };
    await db
      .prepare(
        `UPDATE stage_sessions SET status = @status, currentTeamId = @currentTeamId,
           pitchSeconds = @pitchSeconds, pitchStartedAt = @pitchStartedAt,
           pitchElapsedMs = @pitchElapsedMs, votingOpen = @votingOpen, updatedAt = @updatedAt
         WHERE hackathonId = @hackathonId`,
      )
      .run({
        hackathonId,
        status: next.status,
        currentTeamId: next.currentTeamId,
        pitchSeconds: next.pitchSeconds,
        pitchStartedAt: next.pitchStartedAt,
        pitchElapsedMs: Math.round(next.pitchElapsedMs),
        votingOpen: next.votingOpen ? 1 : 0,
        updatedAt: stamp(new Date()),
      });
    return next;
  })();
}

// ---------- fila ----------

/** times da edição que podem subir no palco: os que têm projeto (mesmo gate do voto 025) */
export async function listStageCandidates(hackathonId: string): Promise<StageTeam[]> {
  const rows = await db
    .prepare(
      `SELECT t.id AS teamId, t.name AS teamName, tp.title, tp.logoUrl
       FROM teams t JOIN team_projects tp ON tp.teamId = t.id
       WHERE t.hackathonId = ?
       ORDER BY t.name`,
    )
    .all<Omit<StageTeam, "members">>(hackathonId);
  return attachMembers(rows);
}

async function attachMembers(rows: Omit<StageTeam, "members">[]): Promise<StageTeam[]> {
  if (rows.length === 0) return [];
  const ms = await db
    .prepare("SELECT teamId, username FROM team_members WHERE teamId = ANY(?) ORDER BY username")
    .all<{ teamId: number; username: string }>(rows.map((r) => r.teamId));
  return rows.map((r) => ({
    ...r,
    members: ms.filter((m) => m.teamId === r.teamId).map((m) => m.username),
  }));
}

export async function getQueue(hackathonId: string): Promise<StageTeam[]> {
  const rows = await db
    .prepare(
      `SELECT q.teamId, t.name AS teamName, tp.title, tp.logoUrl
       FROM stage_queue q
       JOIN teams t ON t.id = q.teamId
       JOIN team_projects tp ON tp.teamId = q.teamId
       WHERE q.hackathonId = ?
       ORDER BY q.position`,
    )
    .all<Omit<StageTeam, "members">>(hackathonId);
  return attachMembers(rows);
}

/** substitui a ordem dos pitches. Só times com projeto da própria edição. */
export async function setQueue(hackathonId: string, teamIds: unknown): Promise<StageTeam[]> {
  if (!Array.isArray(teamIds) || teamIds.some((t) => !Number.isSafeInteger(t) || (t as number) <= 0)) {
    throw new StageError("fila inválida — mande a lista de times", 400);
  }
  const ids = teamIds as number[];
  if (new Set(ids).size !== ids.length) throw new StageError("time repetido na fila", 400);
  const allowed = new Set((await listStageCandidates(hackathonId)).map((c) => c.teamId));
  if (ids.some((id) => !allowed.has(id))) {
    throw new StageError("só entra na fila time desta edição com projeto cadastrado", 400);
  }
  await mutate(hackathonId, async (s) => {
    if (s.status === "ended") throw new StageError("a final já foi encerrada", 409);
    if (s.currentTeamId !== null && !ids.includes(s.currentTeamId)) {
      throw new StageError("o time que está no palco precisa continuar na fila", 409);
    }
    await db.prepare("DELETE FROM stage_queue WHERE hackathonId = ?").run(hackathonId);
    for (const [i, teamId] of ids.entries()) {
      await db
        .prepare("INSERT INTO stage_queue (hackathonId, teamId, position) VALUES (?, ?, ?)")
        .run(hackathonId, teamId, i + 1);
    }
    return {};
  });
  return getQueue(hackathonId);
}

// ---------- avanço ----------

const freshPitch = { votingOpen: false, pitchStartedAt: null, pitchElapsedMs: 0 } as const;

/**
 * Próximo (+1) / anterior (-1). `expected` é o time que o controle estava
 * vendo: se o palco já mudou (duplo toque, dois operadores), 409 em vez de
 * pular um pitch. Trocar de pitch fecha a votação e zera o cronômetro.
 */
export async function advanceStage(
  hackathonId: string,
  dir: 1 | -1,
  expected?: number | null,
): Promise<StageSession> {
  const queue = (await getQueue(hackathonId)).map((t) => t.teamId);
  return mutate(hackathonId, (s) => {
    if (s.status === "ended") throw new StageError("a final já foi encerrada", 409);
    if (expected !== undefined && expected !== s.currentTeamId) {
      throw new StageError("o palco já mudou — a tela atualizou, confere e tenta de novo", 409);
    }
    if (queue.length === 0) throw new StageError("monte a fila dos pitches antes", 409);
    const idx = s.currentTeamId === null ? -1 : queue.indexOf(s.currentTeamId);
    const nextIdx = idx === -1 ? (dir === 1 ? 0 : -1) : idx + dir;
    if (nextIdx < 0) throw new StageError("já está no primeiro pitch", 409);
    if (nextIdx >= queue.length) throw new StageError("acabou a fila — encerre a final", 409);
    return { status: "live", currentTeamId: queue[nextIdx], ...freshPitch };
  });
}

/** pula direto pra um time da fila (o organizador toca no nome) */
export async function goToTeam(hackathonId: string, teamId: number): Promise<StageSession> {
  const queue = (await getQueue(hackathonId)).map((t) => t.teamId);
  if (!queue.includes(teamId)) throw new StageError("esse time não está na fila", 400);
  return mutate(hackathonId, (s) => {
    if (s.status === "ended") throw new StageError("a final já foi encerrada", 409);
    if (s.currentTeamId === teamId) return null;
    return { status: "live", currentTeamId: teamId, ...freshPitch };
  });
}

// ---------- cronômetro ----------

export function elapsedMs(s: Pick<StageSession, "pitchStartedAt" | "pitchElapsedMs">, now: Date): number {
  const run = s.pitchStartedAt ? Math.max(0, now.getTime() - parseStamp(s.pitchStartedAt).getTime()) : 0;
  return s.pitchElapsedMs + run;
}

export async function startTimer(hackathonId: string, now = new Date()): Promise<StageSession> {
  return mutate(hackathonId, (s) => {
    if (s.status !== "live" || s.currentTeamId === null) {
      throw new StageError("nenhum pitch no palco", 409);
    }
    if (s.pitchStartedAt) return null; // já rodando — idempotente
    return { pitchStartedAt: stamp(now) };
  });
}

export async function pauseTimer(hackathonId: string, now = new Date()): Promise<StageSession> {
  return mutate(hackathonId, (s) => {
    if (!s.pitchStartedAt) return null;
    return { pitchElapsedMs: elapsedMs(s, now), pitchStartedAt: null };
  });
}

export async function resetTimer(hackathonId: string): Promise<StageSession> {
  return mutate(hackathonId, () => ({ pitchStartedAt: null, pitchElapsedMs: 0 }));
}

export async function setPitchSeconds(hackathonId: string, seconds: unknown): Promise<StageSession> {
  if (!Number.isInteger(seconds) || (seconds as number) < PITCH_MIN || (seconds as number) > PITCH_MAX) {
    throw new StageError(`tempo de pitch entre ${PITCH_MIN}s e ${PITCH_MAX / 60}min`, 400);
  }
  return mutate(hackathonId, () => ({ pitchSeconds: seconds as number }));
}

// ---------- votação ----------

export async function setVoting(hackathonId: string, open: boolean): Promise<StageSession> {
  return mutate(hackathonId, (s) => {
    if (open && (s.status !== "live" || s.currentTeamId === null)) {
      throw new StageError("nenhum pitch no palco pra abrir votação", 409);
    }
    if (s.votingOpen === open) return null;
    return { votingOpen: open };
  });
}

/** encerra a final: fecha votação, tira o time do palco e libera o ranking. Idempotente. */
export async function endStage(hackathonId: string): Promise<StageSession> {
  return mutate(hackathonId, (s) => {
    if (s.status === "ended") return null;
    if (s.status === "idle") throw new StageError("a final nem começou", 409);
    return { status: "ended", currentTeamId: null, ...freshPitch };
  });
}

/** desfaz um "encerrar" apertado sem querer — volta ao vivo sem ninguém no palco */
export async function reopenStage(hackathonId: string): Promise<StageSession> {
  return mutate(hackathonId, (s) => {
    if (s.status !== "ended") throw new StageError("a final não está encerrada", 409);
    return { status: "live", currentTeamId: null, ...freshPitch };
  });
}

// ---------- voto do público ----------

export type VoterStatus =
  | { ok: true; teamId: number | null }
  | { ok: false; reason: "no_checkin" };

/** quem fez check-in na edição vota; devolve também o time da pessoa (pra barrar o próprio) */
export async function voterStatus(hackathonId: string, memberId: number): Promise<VoterStatus> {
  const row = await db
    .prepare(
      `SELECT 1 AS x FROM registrations r JOIN checkins c ON c.registrationId = r.id
       WHERE r.hackathonId = ? AND r.memberId = ? AND r.status = 'approved'`,
    )
    .get(hackathonId, memberId);
  if (!row) return { ok: false, reason: "no_checkin" };
  const team = await db
    .prepare(
      `SELECT t.id FROM teams t
       JOIN team_members tm ON tm.teamId = t.id
       JOIN members m ON m.username = tm.username
       WHERE t.hackathonId = ? AND m.id = ?`,
    )
    .get<{ id: number }>(hackathonId, memberId);
  return { ok: true, teamId: team?.id ?? null };
}

/**
 * Vota (ou muda o voto) no pitch que está no palco. Ordem dos erros:
 * 400 nota inválida → 403 sem check-in → 403 próprio time → 409 votação
 * fechada / pitch já passou. O INSERT é condicionado à sessão no mesmo
 * comando: voto que chega depois do "fechar votação" não entra.
 */
export async function castLiveVote(
  hackathonId: string,
  memberId: number,
  teamId: unknown,
  score: unknown,
): Promise<{ score: number }> {
  if (!Number.isInteger(score) || (score as number) < 1 || (score as number) > 5) {
    throw new StageError("nota de 1 a 5", 400);
  }
  if (!Number.isSafeInteger(teamId)) throw new StageError("pitch inválido", 400);
  const voter = await voterStatus(hackathonId, memberId);
  if (!voter.ok) throw new StageError("só vota quem fez check-in nesta edição", 403);
  if (voter.teamId === teamId) throw new StageError("não dá pra votar no teu próprio time", 403);

  const now = stamp(new Date());
  const res = await db
    .prepare(
      `INSERT INTO live_votes (hackathonId, teamId, memberId, score, createdAt, updatedAt)
       SELECT @h, @teamId, @memberId, @score, @now, @now
       WHERE EXISTS (
         SELECT 1 FROM stage_sessions
         WHERE hackathonId = @h AND status = 'live' AND votingOpen = 1 AND currentTeamId = @teamId)
       ON CONFLICT (hackathonId, memberId, teamId)
       DO UPDATE SET score = excluded.score, updatedAt = excluded.updatedAt`,
    )
    .run({ h: hackathonId, teamId, memberId, score, now });
  if (res.changes === 0) {
    const s = await getSession(hackathonId);
    if (s.status !== "live") throw new StageError("a final não está ao vivo", 409);
    if (s.currentTeamId !== teamId) throw new StageError("esse pitch já saiu do palco", 409);
    throw new StageError("votação fechada pra esse pitch", 409);
  }
  return { score: score as number };
}

export async function getMyLiveVote(
  hackathonId: string,
  memberId: number,
  teamId: number,
): Promise<number | null> {
  const row = await db
    .prepare("SELECT score FROM live_votes WHERE hackathonId = ? AND memberId = ? AND teamId = ?")
    .get<{ score: number }>(hackathonId, memberId, teamId);
  return row ? Number(row.score) : null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function tallyFor(hackathonId: string, teamId: number): Promise<Tally> {
  const rows = await db
    .prepare(
      `SELECT score, COUNT(*)::int AS n FROM live_votes
       WHERE hackathonId = ? AND teamId = ? GROUP BY score`,
    )
    .all<{ score: number; n: number }>(hackathonId, teamId);
  const dist = [0, 0, 0, 0, 0];
  let count = 0;
  let sum = 0;
  for (const r of rows) {
    dist[Number(r.score) - 1] = Number(r.n);
    count += Number(r.n);
    sum += Number(r.score) * Number(r.n);
  }
  return { count, sum, avg: count ? round2(sum / count) : null, dist };
}

/**
 * "Escolha do público": todos os times da fila, ordenados pela média
 * (arredondada em 2 casas — o que aparece na tela é o que decide). Mesma
 * média = mesma posição e `tied` ligado (ranking 1,1,3); a ordem dentro do
 * empate é só de exibição (mais votos primeiro). Time sem voto fica no fim.
 */
export async function liveRanking(hackathonId: string): Promise<RankingEntry[]> {
  const queue = await getQueue(hackathonId);
  if (queue.length === 0) return [];
  const agg = await db
    .prepare(
      `SELECT teamId, COUNT(*)::int AS votes, SUM(score)::int AS sum FROM live_votes
       WHERE hackathonId = ? GROUP BY teamId`,
    )
    .all<{ teamId: number; votes: number; sum: number }>(hackathonId);
  const byTeam = new Map(agg.map((a) => [a.teamId, a]));
  const rows = queue.map((t) => {
    const a = byTeam.get(t.teamId);
    const votes = Number(a?.votes ?? 0);
    const sum = Number(a?.sum ?? 0);
    return {
      teamId: t.teamId,
      teamName: t.teamName,
      title: t.title,
      logoUrl: t.logoUrl,
      votes,
      sum,
      avg: votes ? round2(sum / votes) : null,
    };
  });
  rows.sort(
    (a, b) =>
      (b.avg ?? -1) - (a.avg ?? -1) || b.votes - a.votes || a.teamName.localeCompare(b.teamName, "pt-BR"),
  );
  return rows.map((r, i) => {
    const first = rows.findIndex((o) => o.avg === r.avg);
    const tied = r.avg !== null && rows.filter((o) => o.avg === r.avg).length > 1;
    return { ...r, position: r.avg === null ? i + 1 : first + 1, tied };
  });
}

/** resultado do público pra ficha do projeto — só depois da final encerrada e com voto */
export async function getAudienceResult(
  teamId: number,
): Promise<{ position: number; avg: number; votes: number; tied: boolean; total: number } | null> {
  const team = await db
    .prepare(
      `SELECT t.hackathonId FROM teams t
       JOIN stage_sessions s ON s.hackathonId = t.hackathonId AND s.status = 'ended'
       WHERE t.id = ?`,
    )
    .get<{ hackathonId: string }>(teamId);
  if (!team) return null;
  const ranking = await liveRanking(team.hackathonId);
  const me = ranking.find((r) => r.teamId === teamId);
  if (!me || me.avg === null) return null;
  return {
    position: me.position,
    avg: me.avg,
    votes: me.votes,
    tied: me.tied,
    total: ranking.filter((r) => r.avg !== null).length,
  };
}

// ---------- snapshot público ----------

export async function getStageSnapshot(hackathonId: string, now = new Date()): Promise<StageSnapshot> {
  const [s, queue] = await Promise.all([getSession(hackathonId), getQueue(hackathonId)]);
  const idx = s.currentTeamId === null ? -1 : queue.findIndex((t) => t.teamId === s.currentTeamId);
  const cur = idx >= 0 ? queue[idx] : null;
  const elapsed = elapsedMs(s, now);
  const [tally, ranking] = await Promise.all([
    cur ? tallyFor(hackathonId, cur.teamId) : Promise.resolve(null),
    s.status === "ended" ? liveRanking(hackathonId) : Promise.resolve(null),
  ]);
  return {
    hackathonId,
    status: s.status,
    current: cur ? { ...cur, position: idx + 1 } : null,
    total: queue.length,
    upNext: queue
      .slice(idx + 1, idx + 4)
      .map((t) => ({ teamId: t.teamId, teamName: t.teamName, title: t.title })),
    timer: {
      pitchSeconds: s.pitchSeconds,
      running: s.pitchStartedAt !== null,
      startedAt: s.pitchStartedAt,
      elapsedMs: s.pitchElapsedMs,
      remainingMs: s.pitchSeconds * 1000 - elapsed,
    },
    votingOpen: s.votingOpen,
    tally,
    ranking,
    serverNow: now.toISOString(),
  };
}

/** chave de mudança do snapshot: ignora o relógio (o cliente conta sozinho) */
export function snapshotKey(snap: StageSnapshot): string {
  return JSON.stringify({ ...snap, serverNow: null, timer: { ...snap.timer, remainingMs: null } });
}

// ---------- visão do controle ----------

export type StageAdminState = {
  snapshot: StageSnapshot;
  queue: StageTeam[];
  candidates: StageTeam[];
  /** o controle vê o ranking parcial o tempo todo; o público só no fim */
  ranking: RankingEntry[];
};

export async function getStageAdmin(hackathonId: string): Promise<StageAdminState> {
  const [snapshot, queue, candidates, ranking] = await Promise.all([
    getStageSnapshot(hackathonId),
    getQueue(hackathonId),
    listStageCandidates(hackathonId),
    liveRanking(hackathonId),
  ]);
  return { snapshot, queue, candidates, ranking };
}

export const STAGE_ACTIONS = [
  "queue",
  "next",
  "prev",
  "goto",
  "timer-start",
  "timer-pause",
  "timer-reset",
  "pitch-seconds",
  "voting-open",
  "voting-close",
  "end",
  "reopen",
] as const;
export type StageAction = (typeof STAGE_ACTIONS)[number];

/** despacha uma ação do controle (o body do POST); erros saem como StageError */
export async function runStageAction(hackathonId: string, body: Record<string, unknown>): Promise<void> {
  const action = body.action;
  if (typeof action !== "string" || !(STAGE_ACTIONS as readonly string[]).includes(action)) {
    throw new StageError(`ação inválida — use uma de: ${STAGE_ACTIONS.join(", ")}`, 400);
  }
  // `from` = time que o controle via no palco (null = ninguém); ausente = sem checagem
  let from: number | null | undefined;
  if (body.from === undefined) from = undefined;
  else if (body.from === null) from = null;
  else if (Number.isSafeInteger(body.from)) from = body.from as number;
  else throw new StageError("from inválido", 400);
  switch (action as StageAction) {
    case "queue":
      await setQueue(hackathonId, body.teamIds);
      return;
    case "next":
      await advanceStage(hackathonId, 1, from);
      return;
    case "prev":
      await advanceStage(hackathonId, -1, from);
      return;
    case "goto":
      if (!Number.isSafeInteger(body.teamId)) throw new StageError("teamId inválido", 400);
      await goToTeam(hackathonId, body.teamId as number);
      return;
    case "timer-start":
      await startTimer(hackathonId);
      return;
    case "timer-pause":
      await pauseTimer(hackathonId);
      return;
    case "timer-reset":
      await resetTimer(hackathonId);
      return;
    case "pitch-seconds":
      await setPitchSeconds(hackathonId, body.seconds);
      return;
    case "voting-open":
      await setVoting(hackathonId, true);
      return;
    case "voting-close":
      await setVoting(hackathonId, false);
      return;
    case "end":
      await endStage(hackathonId);
      return;
    case "reopen":
      await reopenStage(hackathonId);
      return;
  }
}
