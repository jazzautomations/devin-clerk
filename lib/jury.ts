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

/** 409 de publicação com avaliação faltando: leva as contagens pra tela */
export class JuryPublishIncomplete extends JuryError {
  missing: number;
  missingScores: number;
  constructor(missing: number, missingScores: number) {
    super(
      `${missingScores === 1 ? "falta 1 nota" : `faltam ${missingScores} notas`} em ${missing} ${
        missing === 1 ? "avaliação" : "avaliações"
      }. Espere o júri terminar ou publique informando o motivo.`,
      409,
    );
    this.missing = missing;
    this.missingScores = missingScores;
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
  /**
   * falta nota: algum jurado atribuído não deu nota em algum critério (ou,
   * sem lista de atribuição, algum critério ficou sem nota). Time incompleto
   * vai pra trás de todo time completo, seja qual for a média parcial.
   */
  incomplete: boolean;
  /** quantas notas (jurado × critério) faltam pra fechar a avaliação do time */
  missingScores: number;
};

export type AssignmentRow = { judgeMemberId: number; teamId: number };

const round = (n: number) => Math.round(n * 10000) / 10000;

/**
 * Ranking puro: média de cada critério entre jurados, ponderada pelo peso dos
 * critérios que receberam nota. Empate = mesma média (4 casas) dentro do
 * mesmo grupo (completos ou incompletos); empatados dividem a posição e o
 * próximo pula (1, 1, 3). Sem nota vai pro fim sem posição.
 *
 * `assignments` diz quem precisava avaliar cada time. Sem ela, conta como
 * jurado do time quem deu alguma nota pra ele.
 */
export function computeRanking(
  teams: { id: number; name: string; title: string | null }[],
  criteria: { id: number; weight: number }[],
  scores: ScoreRow[],
  assignments?: AssignmentRow[],
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
    const expected = new Set(
      assignments
        ? assignments.filter((a) => a.teamId === t.id).map((a) => a.judgeMemberId)
        : counted.map((s) => s.judgeMemberId),
    );
    const given = new Set(counted.map((s) => `${s.judgeMemberId}:${s.criterionId}`));
    let missingScores = 0;
    for (const j of expected) {
      for (const c of criteria) if (!given.has(`${j}:${c.id}`)) missingScores++;
    }
    return {
      teamId: t.id,
      name: t.name,
      title: t.title,
      weighted: weights > 0 ? round(sum / weights) : null,
      perCriterion,
      judges: new Set(counted.map((s) => s.judgeMemberId)).size,
      rank: null,
      tied: false,
      incomplete: weights > 0 && missingScores > 0,
      missingScores,
    };
  });

  const sameGroup = (a: RankingRow, b: RankingRow) => a.incomplete === b.incomplete && a.weighted === b.weighted;
  rows.sort((a, b) => {
    if (a.weighted === null && b.weighted === null) return a.name.localeCompare(b.name);
    if (a.weighted === null) return 1;
    if (b.weighted === null) return -1;
    if (a.incomplete !== b.incomplete) return a.incomplete ? 1 : -1;
    return b.weighted - a.weighted || a.name.localeCompare(b.name);
  });
  rows.forEach((r, i) => {
    if (r.weighted === null) return;
    const prev = rows[i - 1];
    r.rank = prev && sameGroup(prev, r) ? prev.rank : i + 1;
  });
  for (const r of rows) {
    if (r.weighted === null) continue;
    r.tied = rows.filter((o) => sameGroup(o, r)).length > 1;
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

/** depois de publicado, a rubrica não muda: o pódio saiu dessas regras */
async function assertRubricOpen(hackathonId: string) {
  if (await isPublished(hackathonId)) {
    throw new JuryError("resultado já publicado: a rubrica está travada", 409);
  }
}

export async function addCriterion(
  hackathonId: string,
  input: { label: unknown; weight: unknown },
): Promise<Criterion> {
  await assertRubricOpen(hackathonId);
  const label = validLabel(input.label);
  const weight = validWeight(input.weight);
  const dup = await db
    .prepare("SELECT 1 FROM rubric_criteria WHERE hackathonId = ? AND lower(label) = lower(?)")
    .get(hackathonId, label);
  if (dup) throw new JuryError("já existe um critério com esse nome", 409);
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
  await assertRubricOpen(hackathonId);
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
  await assertRubricOpen(hackathonId);
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
  /** nota interna pra organização (o time nunca vê) */
  comment: string | null;
  /** roadmap 037 #9 — feedback pro time, por critério e geral */
  feedback: Record<number, string>;
  generalFeedback: string | null;
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
  const [mine, general] = await Promise.all([
    db
      .prepare(
        `SELECT s.teamId, s.criterionId, s.score, s.comment, s.feedback FROM scores s
         JOIN rubric_criteria c ON c.id = s.criterionId
         WHERE c.hackathonId = ? AND s.judgeMemberId = ?
         ORDER BY s.updatedAt DESC`,
      )
      .all<{ teamId: number; criterionId: number; score: number; comment: string | null; feedback: string | null }>(
        hackathonId,
        judgeMemberId,
      ),
    db
      .prepare(
        `SELECT f.teamId, f.comment FROM jury_team_feedback f
         JOIN teams t ON t.id = f.teamId
         WHERE t.hackathonId = ? AND f.judgeMemberId = ?`,
      )
      .all<{ teamId: number; comment: string }>(hackathonId, judgeMemberId),
  ]);
  return teams.map((t) => {
    const rows = mine.filter((s) => s.teamId === t.id);
    return {
      ...t,
      scores: Object.fromEntries(rows.map((s) => [s.criterionId, s.score])),
      comment: rows.find((s) => s.comment)?.comment ?? null,
      feedback: Object.fromEntries(
        rows.filter((s) => s.feedback).map((s) => [s.criterionId, s.feedback as string]),
      ),
      generalFeedback: general.find((g) => g.teamId === t.id)?.comment ?? null,
      judged: versions.get(t.id) ?? null,
    };
  });
}

export const FEEDBACK_MAX = 2000;

const cleanText = (v: string | null | undefined) =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, FEEDBACK_MAX) : null;

/**
 * Grava (upsert) as notas de um jurado pra um time. O comentário (nota
 * interna pra organização) vale pro projeto inteiro e vai em todas as linhas
 * gravadas nessa submissão.
 *
 * roadmap 037 #9 — feedback PRO TIME: `feedback` de cada entrada é o
 * comentário daquele critério e `generalFeedback` o geral. undefined =
 * mantém o que estava; null/"" = apaga. O time só lê depois da publicação
 * e da liberação (lib/juryFeedback), sem nome de jurado.
 */
export async function saveScores(
  hackathonId: string,
  judgeMemberId: number,
  teamId: number,
  entries: { criterionId: number; score: number; feedback?: string | null }[],
  comment: string | null,
  generalFeedback?: string | null,
) {
  if (await isPublished(hackathonId)) throw new JuryError("resultado já publicado; notas travadas", 409);
  if (!Number.isInteger(teamId)) throw new JuryError("teamId inválido");
  // papel vigente: quem perdeu o papel de jurado não dá mais nota, mesmo com
  // atribuição antiga sobrando
  if (!(await isJudge(hackathonId, judgeMemberId))) throw new JuryError("você não é jurado(a) desta edição", 403);
  const assigned = await db
    .prepare("SELECT 1 FROM judge_assignments WHERE hackathonId = ? AND judgeMemberId = ? AND teamId = ?")
    .get(hackathonId, judgeMemberId, teamId);
  if (!assigned) throw new JuryError("esse projeto não foi atribuído a você", 403);
  if (await hasConflict(teamId, judgeMemberId)) {
    throw new JuryError("conflito de interesse: não dá pra avaliar o próprio time", 403);
  }
  if (!Array.isArray(entries) || entries.length === 0) throw new JuryError("mande ao menos uma nota");
  const valid = new Set((await listCriteria(hackathonId)).map((c) => c.id));
  for (const e of entries) {
    if (!e || !valid.has(Number(e.criterionId))) throw new JuryError("critério inválido");
    if (!Number.isInteger(e.score) || e.score < 1 || e.score > 5) throw new JuryError("nota precisa ser inteira de 1 a 5");
  }
  const note = cleanText(comment);
  await db.transaction(async () => {
    for (const e of entries) {
      const keep = e.feedback === undefined;
      await db
        .prepare(
          `INSERT INTO scores (judgeMemberId, teamId, criterionId, score, comment, feedback, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, sqlite_now())
           ON CONFLICT (judgeMemberId, teamId, criterionId)
           DO UPDATE SET score = EXCLUDED.score, comment = EXCLUDED.comment, updatedAt = EXCLUDED.updatedAt,
             feedback = CASE WHEN ?::int = 1 THEN scores.feedback ELSE EXCLUDED.feedback END`,
        )
        .run(judgeMemberId, teamId, Number(e.criterionId), e.score, note, keep ? null : cleanText(e.feedback), keep ? 1 : 0);
    }
    if (generalFeedback !== undefined) {
      const text = cleanText(generalFeedback);
      if (text) {
        await db
          .prepare(
            `INSERT INTO jury_team_feedback (judgeMemberId, teamId, comment, updatedAt)
             VALUES (?, ?, ?, sqlite_now())
             ON CONFLICT (judgeMemberId, teamId) DO UPDATE SET comment = EXCLUDED.comment, updatedAt = EXCLUDED.updatedAt`,
          )
          .run(judgeMemberId, teamId, text);
      } else {
        await db.prepare("DELETE FROM jury_team_feedback WHERE judgeMemberId = ? AND teamId = ?").run(judgeMemberId, teamId);
      }
    }
  })();
}

// ---------- progresso, ranking, publicação ----------

export type JuryProgress = {
  /** avaliações = pares jurado×time atribuídos */
  expected: number;
  done: number;
  missing: number;
  /** notas soltas (jurado × time × critério) que faltam */
  missingScores: number;
  byJudge: { memberId: number; username: string; assigned: number; complete: number }[];
};

// só conta jurado com papel vigente E atribuição vigente: tirar o papel ou
// desatribuir tira as notas dele do ranking e do progresso
const ACTIVE_ASSIGNMENT = `
  JOIN edition_roles er ON er.hackathonId = a.hackathonId AND er.memberId = a.judgeMemberId AND er.role = 'jurado'`;

export async function juryProgress(hackathonId: string): Promise<JuryProgress> {
  const nCriteria = (await listCriteria(hackathonId)).length;
  const rows = await db
    .prepare(
      `SELECT a.judgeMemberId AS memberId, m.username,
              COUNT(*) AS assigned,
              COUNT(*) FILTER (WHERE (
                SELECT COUNT(*) FROM scores s JOIN rubric_criteria c ON c.id = s.criterionId
                WHERE s.judgeMemberId = a.judgeMemberId AND s.teamId = a.teamId AND c.hackathonId = a.hackathonId
              ) >= ?) AS complete,
              SUM((
                SELECT COUNT(*) FROM scores s JOIN rubric_criteria c ON c.id = s.criterionId
                WHERE s.judgeMemberId = a.judgeMemberId AND s.teamId = a.teamId AND c.hackathonId = a.hackathonId
              )) AS given
       FROM judge_assignments a JOIN members m ON m.id = a.judgeMemberId ${ACTIVE_ASSIGNMENT}
       WHERE a.hackathonId = ?
       GROUP BY a.judgeMemberId, m.username
       ORDER BY m.username`,
    )
    .all<{ memberId: number; username: string; assigned: number; complete: number; given: number }>(
      Math.max(nCriteria, 1),
      hackathonId,
    );
  const expected = rows.reduce((a, r) => a + Number(r.assigned), 0);
  const done = nCriteria === 0 ? 0 : rows.reduce((a, r) => a + Number(r.complete), 0);
  const given = rows.reduce((a, r) => a + Number(r.given ?? 0), 0);
  return {
    expected,
    done,
    missing: expected - done,
    missingScores: Math.max(0, expected * nCriteria - given),
    byJudge: rows.map((r) => ({
      memberId: r.memberId,
      username: r.username,
      assigned: Number(r.assigned),
      complete: nCriteria === 0 ? 0 : Number(r.complete),
    })),
  };
}

/** atribuições de jurado com papel vigente */
export async function activeAssignments(hackathonId: string): Promise<AssignmentRow[]> {
  return db
    .prepare(
      `SELECT a.judgeMemberId, a.teamId FROM judge_assignments a ${ACTIVE_ASSIGNMENT}
       WHERE a.hackathonId = ? ORDER BY a.judgeMemberId, a.teamId`,
    )
    .all<AssignmentRow>(hackathonId);
}

/** notas que contam: de jurado com papel e atribuição vigentes */
export async function activeScores(hackathonId: string): Promise<ScoreRow[]> {
  return db
    .prepare(
      `SELECT s.judgeMemberId, s.teamId, s.criterionId, s.score FROM scores s
       JOIN rubric_criteria c ON c.id = s.criterionId
       JOIN judge_assignments a ON a.hackathonId = c.hackathonId AND a.judgeMemberId = s.judgeMemberId AND a.teamId = s.teamId
       ${ACTIVE_ASSIGNMENT}
       WHERE c.hackathonId = ?`,
    )
    .all<ScoreRow>(hackathonId);
}

async function rankingInputs(hackathonId: string) {
  const [teams, criteria, scores, assignments] = await Promise.all([
    listJuryTeams(hackathonId),
    listCriteria(hackathonId),
    activeScores(hackathonId),
    activeAssignments(hackathonId),
  ]);
  return { teams, criteria, scores, assignments };
}

/** ranking ao vivo, calculado das notas de agora (a organização antes de publicar) */
export async function getRanking(hackathonId: string): Promise<RankingRow[]> {
  const { teams, criteria, scores, assignments } = await rankingInputs(hackathonId);
  return computeRanking(teams, criteria, scores, assignments);
}

export type Publication = {
  publishedAt: string;
  publishedBy: number | null;
  forced: boolean;
  reason: string | null;
};

export async function isPublished(hackathonId: string): Promise<Publication | null> {
  return (
    (await db
      .prepare("SELECT publishedAt, publishedBy, forced, reason FROM jury_results WHERE hackathonId = ?")
      .get<Publication>(hackathonId)) ?? null
  );
}

/**
 * O que foi publicado: o ranking congelado na publicação. Edição publicada
 * antes do snapshot existir cai no cálculo ao vivo.
 */
export async function publishedRanking(hackathonId: string): Promise<RankingRow[] | null> {
  const row = await db
    .prepare("SELECT ranking FROM jury_results WHERE hackathonId = ?")
    .get<{ ranking: RankingRow[] | string | null }>(hackathonId);
  if (!row) return null;
  if (row.ranking === null) return getRanking(hackathonId);
  return typeof row.ranking === "string" ? (JSON.parse(row.ranking) as RankingRow[]) : row.ranking;
}

/**
 * Sigilo: antes da publicação só a organização vê o ranking (ao vivo);
 * depois, quem tem papel na edição também, e todo mundo lê o congelado.
 * null = não pode ver.
 */
export async function rankingFor(actor: Actor | null, hackathonId: string): Promise<RankingRow[] | null> {
  if (!actor) return null;
  const manage = await canManageEdition(actor, hackathonId);
  const published = await isPublished(hackathonId);
  if (!published) return manage ? getRanking(hackathonId) : null;
  if (!manage && (await getEditionRoles(hackathonId, actor.id)).length === 0) return null;
  return publishedRanking(hackathonId);
}

export const REASON_MIN = 10;
export const REASON_MAX = 500;

/**
 * grava jury_results (com o ranking congelado), o pódio (rank 1–3, empate
 * divide) em teams.placement e os vencedores de cada categoria de prêmio
 * (ranking recalculado só entre os candidatos da categoria: desafio = quem
 * marcou; finalistsOnly = finalistas).
 *
 * Com avaliação faltando (juryProgress.missing > 0) recusa com 409, a não
 * ser que venha `force` com o motivo, que fica gravado.
 */
export async function publishResults(
  hackathonId: string,
  byMemberId: number | null,
  opts: { force?: boolean; reason?: unknown } = {},
) {
  const progress = await juryProgress(hackathonId);
  const force = opts.force === true;
  const reason = typeof opts.reason === "string" ? opts.reason.trim() : "";
  if (progress.missing > 0) {
    if (!force) {
      throw new JuryPublishIncomplete(progress.missing, progress.missingScores);
    }
    if (reason.length < REASON_MIN) {
      throw new JuryError(`escreva o motivo de publicar com avaliação faltando (mínimo ${REASON_MIN} caracteres)`);
    }
  }
  const forced = progress.missing > 0;
  const { teams, criteria, scores, assignments } = await rankingInputs(hackathonId);
  const ranking = computeRanking(teams, criteria, scores, assignments);
  const podium = ranking
    .filter((r) => r.rank !== null && r.rank <= 3)
    .map((r) => ({ teamId: r.teamId, placement: r.rank! }));
  const [categories, byTeam] = await Promise.all([listCategories(hackathonId), challengesByTeam(hackathonId)]);
  const winners = categories.flatMap((c) => {
    const candidates = categoryCandidates(c, teams, byTeam);
    return pickWinners(computeRanking(candidates, criteria, scores, assignments), c.places).map((w) => ({
      categoryId: c.id,
      ...w,
    }));
  });
  const first = !(await isPublished(hackathonId));
  await db.transaction(async () => {
    await replaceWinners(hackathonId, winners);
    await db.prepare("UPDATE teams SET placement = 0 WHERE hackathonId = ?").run(hackathonId);
    for (const p of podium) {
      await db.prepare("UPDATE teams SET placement = ? WHERE id = ?").run(p.placement, p.teamId);
    }
    await db
      .prepare(
        `INSERT INTO jury_results (hackathonId, publishedAt, publishedBy, ranking, forced, reason)
         VALUES (?, sqlite_now(), ?, ?::jsonb, ?, ?)
         ON CONFLICT (hackathonId) DO UPDATE SET publishedAt = EXCLUDED.publishedAt, publishedBy = EXCLUDED.publishedBy,
           ranking = EXCLUDED.ranking, forced = EXCLUDED.forced, reason = EXCLUDED.reason`,
      )
      .run(hackathonId, byMemberId, JSON.stringify(ranking), forced, forced ? reason.slice(0, REASON_MAX) : null);
  })();
  return { podium, winners, first, forced };
}

/** quem é de algum time avaliado da edição (pra avisar que o resultado saiu) */
export async function juryTeamMemberIds(hackathonId: string): Promise<number[]> {
  const teams = await listJuryTeams(hackathonId);
  if (teams.length === 0) return [];
  const rows = await db
    .prepare(
      `SELECT DISTINCT m.id FROM team_members tm JOIN members m ON m.username = tm.username
       WHERE tm.teamId = ANY(?::int[]) ORDER BY m.id`,
    )
    .all<{ id: number }>(teams.map((t) => t.id));
  return rows.map((r) => r.id);
}
