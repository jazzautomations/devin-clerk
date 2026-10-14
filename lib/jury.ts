import db from "@/lib/db";
import { canManageEdition, getEditionRoles } from "@/lib/roles";
import { challengesByTeam, ELIGIBLE_SQL, judgedVersions, type JudgedVersion } from "@/lib/entries";
import { categoryCandidates, listCategories, pickWinners, replaceWinners } from "@/lib/prizes";

// Júri com rubrica (spec 033 US5, FR-006). Notas são guardadas por critério e
// o ranking é sempre calculado na hora (média ponderada das médias por
// critério), então trocar peso recalcula sem tocar em nota. O resultado fica
// oculto até jury_results ter a linha da edição; publicar grava o pódio em
// teams.placement, que é o que o arquivo da edição já lê. O voto popular
// (lib/votes) é outro sinal e não entra aqui.
//
// spec 034 — edição com prazo de entrega: só time ENVIADO/TRAVADO entra no
// júri (atribuição, ranking, categorias); o jurado avalia o snapshot da
// versão do prazo. Edição sem prazo segue como antes (todo time).

export class JuryError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

type Actor = { id: number; role: string };

export type Criterion = { id: number; label: string; weight: number; position: number };
export type JuryTeam = { id: number; name: string; title: string | null; members: string[]; finalist: boolean };
export type Judge = { memberId: number; username: string; name: string | null };
export type ScoreRow = { judgeMemberId: number; teamId: number; criterionId: number; score: number };

export type RankingRow = {
  teamId: number;
  name: string;
  title: string | null;
  /** média ponderada na escala 1–5; null = ninguém avaliou ainda */
  weighted: number | null;
  /** média de cada critério entre os jurados que avaliaram */
  perCriterion: Record<number, number | null>;
  judges: number;
  rank: number | null;
  tied: boolean;
};

const round = (n: number) => Math.round(n * 10000) / 10000;

/**
 * Ranking puro: média de cada critério entre jurados, ponderada pelo peso dos
 * critérios que receberam nota. Empate = mesma média (4 casas); empatados
 * dividem a posição e o próximo pula (1, 1, 3). Sem nota vai pro fim sem posição.
 */
export function computeRanking(
  teams: { id: number; name: string; title: string | null }[],
  criteria: { id: number; weight: number }[],
  scores: ScoreRow[],
): RankingRow[] {
  const rows: RankingRow[] = teams.map((t) => {
    const mine = scores.filter((s) => s.teamId === t.id);
    const perCriterion: Record<number, number | null> = {};
    let sum = 0;
    let weights = 0;
    for (const c of criteria) {
      const vals = mine.filter((s) => s.criterionId === c.id).map((s) => s.score);
      if (vals.length === 0) {
        perCriterion[c.id] = null;
        continue;
      }
      const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
      perCriterion[c.id] = round(avg);
      sum += avg * c.weight;
      weights += c.weight;
    }
    const counted = mine.filter((s) => criteria.some((c) => c.id === s.criterionId));
    return {
      teamId: t.id,
      name: t.name,
      title: t.title,
      weighted: weights > 0 ? round(sum / weights) : null,
      perCriterion,
      judges: new Set(counted.map((s) => s.judgeMemberId)).size,
      rank: null,
      tied: false,
    };
  });

  rows.sort((a, b) => {
    if (a.weighted === null && b.weighted === null) return a.name.localeCompare(b.name);
    if (a.weighted === null) return 1;
    if (b.weighted === null) return -1;
    return b.weighted - a.weighted || a.name.localeCompare(b.name);
  });
  rows.forEach((r, i) => {
    if (r.weighted === null) return;
    const prev = rows[i - 1];
    r.rank = prev && prev.weighted === r.weighted ? prev.rank : i + 1;
  });
  for (const r of rows) {
    if (r.weighted === null) continue;
    r.tied = rows.filter((o) => o.weighted === r.weighted).length > 1;
  }
  return rows;
}

// ---------- rubrica ----------

function validWeight(w: unknown): number {
  const n = Number(w);
  if (!Number.isInteger(n) || n < 1 || n > 1000) throw new JuryError("peso precisa ser inteiro de 1 a 1000");
  return n;
}

function validLabel(l: unknown): string {
  const s = typeof l === "string" ? l.trim() : "";
  if (!s) throw new JuryError("nome do critério obrigatório");
  if (s.length > 80) throw new JuryError("nome do critério longo demais (máx. 80)");
  return s;
}

export async function listCriteria(hackathonId: string): Promise<Criterion[]> {
  return db
    .prepare("SELECT id, label, weight, position FROM rubric_criteria WHERE hackathonId = ? ORDER BY position, id")
    .all<Criterion>(hackathonId);
}

export async function addCriterion(
  hackathonId: string,
  input: { label: unknown; weight: unknown },
): Promise<Criterion> {
  const label = validLabel(input.label);
  const weight = validWeight(input.weight);
  const row = await db
    .prepare(
      `INSERT INTO rubric_criteria (hackathonId, label, weight, position)
       VALUES (?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM rubric_criteria WHERE hackathonId = ?))
       RETURNING id, label, weight, position`,
    )
    .get<Criterion>(hackathonId, label, weight, hackathonId);
  return row!;
}

async function ownCriterion(hackathonId: string, id: number) {
  const ok = Number.isInteger(id) &&
    (await db.prepare("SELECT 1 FROM rubric_criteria WHERE id = ? AND hackathonId = ?").get(id, hackathonId));
  if (!ok) throw new JuryError("critério não encontrado", 404);
}

export async function updateCriterion(
  hackathonId: string,
  id: number,
  patch: { label?: unknown; weight?: unknown },
): Promise<Criterion> {
  await ownCriterion(hackathonId, id);
  if (patch.label === undefined && patch.weight === undefined) throw new JuryError("nada pra atualizar");
  if (patch.label !== undefined) {
    await db.prepare("UPDATE rubric_criteria SET label = ? WHERE id = ?").run(validLabel(patch.label), id);
  }
  if (patch.weight !== undefined) {
    await db.prepare("UPDATE rubric_criteria SET weight = ? WHERE id = ?").run(validWeight(patch.weight), id);
  }
  return (await db
    .prepare("SELECT id, label, weight, position FROM rubric_criteria WHERE id = ?")
    .get<Criterion>(id))!;
}

/** apaga o critério e as notas dele (o resto do ranking segue) */
export async function removeCriterion(hackathonId: string, id: number) {
  await ownCriterion(hackathonId, id);
  await db.prepare("DELETE FROM rubric_criteria WHERE id = ?").run(id);
}

// ---------- jurados, times, atribuição ----------

/** quem tem o papel jurado de fato na edição (organizador não entra sozinho) */
export async function listJudges(hackathonId: string): Promise<Judge[]> {
  return db
    .prepare(
      `SELECT m.id AS memberId, m.username, m.name
       FROM edition_roles er JOIN members m ON m.id = er.memberId
       WHERE er.hackathonId = ? AND er.role = 'jurado'
       ORDER BY m.username`,
    )
    .all<Judge>(hackathonId);
}

export async function listJuryTeams(hackathonId: string): Promise<JuryTeam[]> {
  const rows = await db
    .prepare(
      `SELECT t.id, t.name, p.title, t.finalist,
              COALESCE(string_agg(tm.username, ',' ORDER BY tm.username), '') AS members
       FROM teams t
       JOIN hackathons h ON h.id = t.hackathonId
       LEFT JOIN team_projects p ON p.teamId = t.id
       LEFT JOIN team_members tm ON tm.teamId = t.id
       WHERE t.hackathonId = ? AND ${ELIGIBLE_SQL("t")}
       GROUP BY t.id, t.name, p.title, t.finalist
       ORDER BY t.name`,
    )
    .all<{ id: number; name: string; title: string | null; members: string; finalist: number }>(hackathonId);
  return rows.map((r) => ({ ...r, finalist: r.finalist === 1, members: r.members ? r.members.split(",") : [] }));
}

/** jurado é integrante do time? (team_members guarda username, não id) */
export async function hasConflict(teamId: number, judgeMemberId: number): Promise<boolean> {
  return !!(await db
    .prepare(
      `SELECT 1 FROM team_members tm JOIN members m ON m.username = tm.username
       WHERE tm.teamId = ? AND m.id = ?`,
    )
    .get(teamId, judgeMemberId));
}

async function isJudge(hackathonId: string, memberId: number) {
  return (await getEditionRoles(hackathonId, memberId)).includes("jurado");
}

async function teamInEdition(hackathonId: string, teamId: number) {
  return Number.isInteger(teamId) &&
    !!(await db.prepare("SELECT 1 FROM teams WHERE id = ? AND hackathonId = ?").get(teamId, hackathonId));
}

export async function assignJudge(hackathonId: string, judgeMemberId: number, teamId: number) {
  if (!Number.isInteger(judgeMemberId) || !(await isJudge(hackathonId, judgeMemberId))) {
    throw new JuryError("essa pessoa não é jurada da edição");
  }
  if (!(await teamInEdition(hackathonId, teamId))) throw new JuryError("time não encontrado", 404);
  const eligible = await db
    .prepare(`SELECT 1 FROM teams t JOIN hackathons h ON h.id = t.hackathonId WHERE t.id = ? AND ${ELIGIBLE_SQL("t")}`)
    .get(teamId);
  if (!eligible) throw new JuryError("time sem entrega enviada não vai pro júri", 409);
  if (await hasConflict(teamId, judgeMemberId)) {
    throw new JuryError("conflito de interesse: jurado é do time", 409);
  }
  await db
    .prepare("INSERT OR IGNORE INTO judge_assignments (hackathonId, judgeMemberId, teamId) VALUES (?, ?, ?)")
    .run(hackathonId, judgeMemberId, teamId);
}

export async function unassignJudge(hackathonId: string, judgeMemberId: number, teamId: number) {
  await db
    .prepare("DELETE FROM judge_assignments WHERE hackathonId = ? AND judgeMemberId = ? AND teamId = ?")
    .run(hackathonId, judgeMemberId, teamId);
}

/**
 * todo jurado × todo time elegível (enviado/travado quando a edição tem
 * prazo), pulando conflito de interesse; idempotente. finalistsOnly = rodada
 * final só com finalistas.
 */
export async function assignAll(
  hackathonId: string,
  opts: { finalistsOnly?: boolean } = {},
): Promise<{ created: number; conflicts: number }> {
  const scope = `${ELIGIBLE_SQL("t")}${opts.finalistsOnly ? " AND t.finalist = 1" : ""}`;
  const conflicts = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM edition_roles er
       JOIN members m ON m.id = er.memberId
       JOIN team_members tm ON tm.username = m.username
       JOIN teams t ON t.id = tm.teamId AND t.hackathonId = er.hackathonId
       JOIN hackathons h ON h.id = t.hackathonId
       WHERE er.hackathonId = ? AND er.role = 'jurado' AND ${scope}`,
    )
    .get<{ n: number }>(hackathonId);
  const res = await db
    .prepare(
      `INSERT INTO judge_assignments (hackathonId, judgeMemberId, teamId)
       SELECT er.hackathonId, er.memberId, t.id
       FROM edition_roles er
       JOIN members m ON m.id = er.memberId
       JOIN teams t ON t.hackathonId = er.hackathonId
       JOIN hackathons h ON h.id = t.hackathonId
       WHERE er.hackathonId = ? AND er.role = 'jurado' AND ${scope}
         AND NOT EXISTS (SELECT 1 FROM team_members tm WHERE tm.teamId = t.id AND tm.username = m.username)
       ON CONFLICT DO NOTHING`,
    )
    .run(hackathonId);
  return { created: res.changes, conflicts: conflicts?.n ?? 0 };
}

export async function listAssignments(hackathonId: string) {
  return db
    .prepare(
      `SELECT judgeMemberId, teamId FROM judge_assignments
       WHERE hackathonId = ? ORDER BY judgeMemberId, teamId`,
    )
    .all<{ judgeMemberId: number; teamId: number }>(hackathonId);
}

// ---------- notas ----------

export type JudgeAssignment = JuryTeam & {
  scores: Record<number, number>;
  comment: string | null;
  /** versão que o jurado avalia (snapshot do prazo); null = edição sem fluxo de entrega */
  judged: JudgedVersion | null;
};

/** o que o jurado enxerga: só os times atribuídos a ele e só as notas dele */
export async function judgeAssignments(hackathonId: string, judgeMemberId: number): Promise<JudgeAssignment[]> {
  const assigned = new Set(
    (await db
      .prepare("SELECT teamId FROM judge_assignments WHERE hackathonId = ? AND judgeMemberId = ?")
      .all<{ teamId: number }>(hackathonId, judgeMemberId)).map((r) => r.teamId),
  );
  const teams = (await listJuryTeams(hackathonId)).filter((t) => assigned.has(t.id));
  const versions = await judgedVersions(hackathonId);
  const mine = await db
    .prepare(
      `SELECT s.teamId, s.criterionId, s.score, s.comment FROM scores s
       JOIN rubric_criteria c ON c.id = s.criterionId
       WHERE c.hackathonId = ? AND s.judgeMemberId = ?
       ORDER BY s.updatedAt DESC`,
    )
    .all<{ teamId: number; criterionId: number; score: number; comment: string | null }>(hackathonId, judgeMemberId);
  return teams.map((t) => {
    const rows = mine.filter((s) => s.teamId === t.id);
    return {
      ...t,
      scores: Object.fromEntries(rows.map((s) => [s.criterionId, s.score])),
      comment: rows.find((s) => s.comment)?.comment ?? null,
      judged: versions.get(t.id) ?? null,
    };
  });
}

/**
 * Grava (upsert) as notas de um jurado pra um time. O comentário vale pro
 * projeto inteiro e vai em todas as linhas gravadas nessa submissão.
 */
export async function saveScores(
  hackathonId: string,
  judgeMemberId: number,
  teamId: number,
  entries: { criterionId: number; score: number }[],
  comment: string | null,
) {
  if (await isPublished(hackathonId)) throw new JuryError("resultado já publicado; notas travadas", 409);
  if (!Number.isInteger(teamId)) throw new JuryError("teamId inválido");
  const assigned = await db
    .prepare("SELECT 1 FROM judge_assignments WHERE hackathonId = ? AND judgeMemberId = ? AND teamId = ?")
    .get(hackathonId, judgeMemberId, teamId);
  if (!assigned) throw new JuryError("projeto não atribuído a ti", 403);
  if (await hasConflict(teamId, judgeMemberId)) {
    throw new JuryError("conflito de interesse: não dá pra avaliar o próprio time", 403);
  }
  if (!Array.isArray(entries) || entries.length === 0) throw new JuryError("mande ao menos uma nota");
  const valid = new Set((await listCriteria(hackathonId)).map((c) => c.id));
  for (const e of entries) {
    if (!e || !valid.has(Number(e.criterionId))) throw new JuryError("critério inválido");
    if (!Number.isInteger(e.score) || e.score < 1 || e.score > 5) throw new JuryError("nota precisa ser inteira de 1 a 5");
  }
  const note = typeof comment === "string" && comment.trim() ? comment.trim().slice(0, 2000) : null;
  await db.transaction(async () => {
    for (const e of entries) {
      await db
        .prepare(
          `INSERT INTO scores (judgeMemberId, teamId, criterionId, score, comment, updatedAt)
           VALUES (?, ?, ?, ?, ?, sqlite_now())
           ON CONFLICT (judgeMemberId, teamId, criterionId)
           DO UPDATE SET score = EXCLUDED.score, comment = EXCLUDED.comment, updatedAt = EXCLUDED.updatedAt`,
        )
        .run(judgeMemberId, teamId, Number(e.criterionId), e.score, note);
    }
  })();
}

// ---------- progresso, ranking, publicação ----------

export type JuryProgress = {
  /** avaliações = pares jurado×time atribuídos */
  expected: number;
  done: number;
  missing: number;
  byJudge: { memberId: number; username: string; assigned: number; complete: number }[];
};

export async function juryProgress(hackathonId: string): Promise<JuryProgress> {
  const nCriteria = (await listCriteria(hackathonId)).length;
  const rows = await db
    .prepare(
      `SELECT a.judgeMemberId AS memberId, m.username,
              COUNT(*) AS assigned,
              COUNT(*) FILTER (WHERE (
                SELECT COUNT(*) FROM scores s JOIN rubric_criteria c ON c.id = s.criterionId
                WHERE s.judgeMemberId = a.judgeMemberId AND s.teamId = a.teamId AND c.hackathonId = a.hackathonId
              ) >= ?) AS complete
       FROM judge_assignments a JOIN members m ON m.id = a.judgeMemberId
       WHERE a.hackathonId = ?
       GROUP BY a.judgeMemberId, m.username
       ORDER BY m.username`,
    )
    .all<{ memberId: number; username: string; assigned: number; complete: number }>(
      Math.max(nCriteria, 1),
      hackathonId,
    );
  const expected = rows.reduce((a, r) => a + r.assigned, 0);
  const done = nCriteria === 0 ? 0 : rows.reduce((a, r) => a + r.complete, 0);
  return {
    expected,
    done,
    missing: expected - done,
    byJudge: rows.map((r) => (nCriteria === 0 ? { ...r, complete: 0 } : r)),
  };
}

async function rankingInputs(hackathonId: string) {
  const [teams, criteria, scores] = await Promise.all([
    listJuryTeams(hackathonId),
    listCriteria(hackathonId),
    db
      .prepare(
        `SELECT s.judgeMemberId, s.teamId, s.criterionId, s.score FROM scores s
         JOIN rubric_criteria c ON c.id = s.criterionId
         WHERE c.hackathonId = ?`,
      )
      .all<ScoreRow>(hackathonId),
  ]);
  return { teams, criteria, scores };
}

export async function getRanking(hackathonId: string): Promise<RankingRow[]> {
  const { teams, criteria, scores } = await rankingInputs(hackathonId);
  return computeRanking(teams, criteria, scores);
}

export async function isPublished(hackathonId: string) {
  return (
    (await db
      .prepare("SELECT publishedAt, publishedBy FROM jury_results WHERE hackathonId = ?")
      .get<{ publishedAt: string; publishedBy: number | null }>(hackathonId)) ?? null
  );
}

/**
 * Sigilo: antes da publicação só a organização vê o ranking; depois, quem
 * tem papel na edição também. null = não pode ver.
 */
export async function rankingFor(actor: Actor | null, hackathonId: string): Promise<RankingRow[] | null> {
  if (!actor) return null;
  if (await canManageEdition(actor, hackathonId)) return getRanking(hackathonId);
  if (!(await isPublished(hackathonId))) return null;
  if ((await getEditionRoles(hackathonId, actor.id)).length === 0) return null;
  return getRanking(hackathonId);
}

/**
 * grava jury_results, o pódio (rank 1–3, empate divide) em teams.placement e
 * os vencedores de cada categoria de prêmio (ranking recalculado só entre os
 * candidatos da categoria: desafio = quem marcou; finalistsOnly = finalistas)
 */
export async function publishResults(hackathonId: string, byMemberId: number | null) {
  const { teams, criteria, scores } = await rankingInputs(hackathonId);
  const ranking = computeRanking(teams, criteria, scores);
  const podium = ranking
    .filter((r) => r.rank !== null && r.rank <= 3)
    .map((r) => ({ teamId: r.teamId, placement: r.rank! }));
  const [categories, byTeam] = await Promise.all([listCategories(hackathonId), challengesByTeam(hackathonId)]);
  const winners = categories.flatMap((c) => {
    const candidates = categoryCandidates(c, teams, byTeam);
    return pickWinners(computeRanking(candidates, criteria, scores), c.places).map((w) => ({
      categoryId: c.id,
      ...w,
    }));
  });
  await db.transaction(async () => {
    await replaceWinners(hackathonId, winners);
    await db.prepare("UPDATE teams SET placement = 0 WHERE hackathonId = ?").run(hackathonId);
    for (const p of podium) {
      await db.prepare("UPDATE teams SET placement = ? WHERE id = ?").run(p.placement, p.teamId);
    }
    await db
      .prepare(
        `INSERT INTO jury_results (hackathonId, publishedAt, publishedBy) VALUES (?, sqlite_now(), ?)
         ON CONFLICT (hackathonId) DO UPDATE SET publishedAt = EXCLUDED.publishedAt, publishedBy = EXCLUDED.publishedBy`,
      )
      .run(hackathonId, byMemberId);
  })();
  return { podium, winners };
}
