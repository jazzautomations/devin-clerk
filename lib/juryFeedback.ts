import db from "@/lib/db";
import { computeRanking, isPublished, listCriteria, listJuryTeams, type Criterion, type ScoreRow } from "@/lib/jury";

// Feedback do júri pro time (roadmap 037 #9, research 036 #5 — lacuna do
// mercado). Regras:
// - só membro do time, logado, lê (nem organizador por aqui: ele já tem a
//   aba júri);
// - só depois do resultado publicado E da liberação ligada pela organização
//   (que pode desligar de novo);
// - anônimo: nenhum id/nome de jurado sai daqui; os comentários de cada
//   critério vêm ordenados pelo texto, não por jurado, pra não dar pra
//   cruzar quem escreveu o quê entre critérios;
// - a nota interna (scores.comment) nunca entra — só scores.feedback e
//   jury_team_feedback, que o jurado escreveu sabendo que o time lê.

export type FeedbackCriterion = {
  id: number;
  label: string;
  weight: number;
  /** média do time nesse critério (1–5); null = ninguém deu nota */
  team: number | null;
  /** média da edição: média das médias dos times avaliados */
  edition: number | null;
  comments: string[];
};

export type TeamFeedback = {
  teamId: number;
  teamName: string;
  hackathonId: string;
  hackathonName: string;
  judges: number;
  weighted: { team: number | null; edition: number | null };
  criteria: FeedbackCriterion[];
  general: string[];
};

export type FeedbackAccess =
  | { status: "unauthorized" }
  | { status: "not_found" }
  | { status: "forbidden" }
  | { status: "hidden"; teamName: string; hackathonId: string; hackathonName: string }
  | { status: "ok"; feedback: TeamFeedback };

const round = (n: number) => Math.round(n * 100) / 100;
const mean = (xs: number[]) => (xs.length ? round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
const byText = (a: string, b: string) => a.localeCompare(b, "pt-BR");

/**
 * Montagem pura: notas por critério do time × média da edição, comentários
 * sem autor. `scores` são de TODA a edição (pra média); `feedback` e
 * `general` só os do time.
 */
export function buildTeamFeedback(
  teamId: number,
  teams: { id: number; name: string; title: string | null }[],
  criteria: Pick<Criterion, "id" | "label" | "weight">[],
  scores: ScoreRow[],
  feedback: { criterionId: number; text: string }[],
  general: string[],
): Pick<TeamFeedback, "judges" | "weighted" | "criteria" | "general"> {
  const ranking = computeRanking(teams, criteria, scores);
  const mine = ranking.find((r) => r.teamId === teamId);
  const judged = ranking.filter((r) => r.weighted !== null);
  return {
    judges: mine?.judges ?? 0,
    weighted: {
      team: mine?.weighted === null || mine === undefined ? null : round(mine.weighted),
      edition: mean(judged.map((r) => r.weighted as number)),
    },
    criteria: criteria.map((c) => {
      const t = mine?.perCriterion[c.id] ?? null;
      return {
        id: c.id,
        label: c.label,
        weight: c.weight,
        team: t === null ? null : round(t),
        edition: mean(ranking.map((r) => r.perCriterion[c.id]).filter((v): v is number => v !== null && v !== undefined)),
        comments: feedback.filter((f) => f.criterionId === c.id).map((f) => f.text).sort(byText),
      };
    }),
    general: [...general].sort(byText),
  };
}

export async function isFeedbackReleased(hackathonId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT juryFeedbackReleased FROM hackathons WHERE id = ?")
    .get<{ juryFeedbackReleased: number }>(hackathonId);
  return row?.juryFeedbackReleased === 1;
}

/** o time enxerga? = resultado publicado + liberação ligada */
export async function feedbackVisible(hackathonId: string): Promise<boolean> {
  const [published, released] = await Promise.all([isPublished(hackathonId), isFeedbackReleased(hackathonId)]);
  return !!published && released;
}

export async function setFeedbackReleased(hackathonId: string, released: boolean) {
  await db.prepare("UPDATE hackathons SET juryFeedbackReleased = ? WHERE id = ?").run(released ? 1 : 0, hackathonId);
}

/** nome do time (público na ficha do projeto); null = não existe */
export async function teamName(teamId: number): Promise<string | null> {
  const row = await db.prepare("SELECT name FROM teams WHERE id = ?").get<{ name: string }>(teamId);
  return row?.name ?? null;
}

async function isTeamMember(teamId: number, username: string) {
  return !!(await db.prepare("SELECT 1 FROM team_members WHERE teamId = ? AND username = ?").get(teamId, username));
}

/** porta única do feedback: quem pergunta + qual time → o que pode ver */
export async function teamFeedbackFor(
  viewer: { id: number; username: string } | null,
  teamId: number,
): Promise<FeedbackAccess> {
  if (!viewer) return { status: "unauthorized" };
  if (!Number.isInteger(teamId) || teamId <= 0) return { status: "not_found" };
  const team = await db
    .prepare(
      `SELECT t.id, t.name, t.hackathonId, h.name AS hackathonName
       FROM teams t JOIN hackathons h ON h.id = t.hackathonId WHERE t.id = ?`,
    )
    .get<{ id: number; name: string; hackathonId: string; hackathonName: string }>(teamId);
  if (!team) return { status: "not_found" };
  if (!(await isTeamMember(teamId, viewer.username))) return { status: "forbidden" };
  if (!(await feedbackVisible(team.hackathonId))) {
    return { status: "hidden", teamName: team.name, hackathonId: team.hackathonId, hackathonName: team.hackathonName };
  }

  const [teams, criteria, scores, feedback, general] = await Promise.all([
    listJuryTeams(team.hackathonId),
    listCriteria(team.hackathonId),
    db
      .prepare(
        `SELECT s.judgeMemberId, s.teamId, s.criterionId, s.score FROM scores s
         JOIN rubric_criteria c ON c.id = s.criterionId
         WHERE c.hackathonId = ?`,
      )
      .all<ScoreRow>(team.hackathonId),
    db
      .prepare(
        `SELECT s.criterionId, s.feedback AS text FROM scores s
         JOIN rubric_criteria c ON c.id = s.criterionId
         WHERE s.teamId = ? AND c.hackathonId = ? AND s.feedback IS NOT NULL`,
      )
      .all<{ criterionId: number; text: string }>(teamId, team.hackathonId),
    db
      .prepare("SELECT comment FROM jury_team_feedback WHERE teamId = ?")
      .all<{ comment: string }>(teamId),
  ]);
  return {
    status: "ok",
    feedback: {
      teamId,
      teamName: team.name,
      hackathonId: team.hackathonId,
      hackathonName: team.hackathonName,
      ...buildTeamFeedback(
        teamId,
        teams,
        criteria,
        scores,
        feedback,
        general.map((g) => g.comment),
      ),
    },
  };
}
