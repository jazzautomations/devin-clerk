import db from "@/lib/db";
import { collectDossierQuietly } from "@/lib/dossier";
import { parseEventTime } from "@/lib/eventTime";
import type { FetchOpts, GithubCommit } from "@/lib/githubCommits";

// Continuação do projeto (spec 046, onda 3, migration 044).
//
// Duas coisas que o projeto vivo precisa e o dossiê (029) já quase dava:
//
// 1. SELO "continuou": o time entregou no evento e seguiu commitando depois.
//    O cron mensal (POST /api/cron/continuidade, deploy/continuidade.sh)
//    re-coleta o dossiê dos times com repositório de edição encerrada há 30 a
//    400 dias e grava team_projects.continuedAt com a data do PRIMEIRO commit
//    depois de fim da edição + 30 dias. Nada de coletor novo: o dossiê é a
//    fonte única (lib/dossier.ts), com o mesmo rate limit do GitHub.
//
// 2. CONTINUAÇÃO ENTRE EDIÇÕES: no editor da entrega o time marca "este
//    projeto continua" e escolhe um projeto anterior de que fez parte. O que
//    já existia continua em team_projects.priorWork (010/029) — aqui só entra
//    o link (continuesTeamId).
//
// O selo não é prêmio, nota nem XP: é informação pro visitante de /p e o
// filtro ?continuou=1 de /projetos.

const DAY = 86_400_000;
/** o commit precisa ser pelo menos 30 dias depois do fim da edição */
export const CONTINUED_AFTER_DAYS = 30;
/** janela de edições que o cron olha (mais velho que isso não muda mais) */
export const CONTINUITY_MIN_DAYS = 30;
export const CONTINUITY_MAX_DAYS = 400;
/** no máximo isso por execução, os mais antigos primeiro (cota do GitHub) */
export const CONTINUITY_LIMIT = 50;
/** não re-coleta o mesmo time antes disso: o cron é mensal */
export const CONTINUITY_RECOLLECT_DAYS = 25;

const utc = (v: string) => new Date(`${v.replace(" ", "T")}Z`);

function parseCommits(json: string | null): GithubCommit[] {
  try {
    const arr = JSON.parse(json ?? "[]");
    return Array.isArray(arr) ? (arr as GithubCommit[]) : [];
  } catch {
    return [];
  }
}

/**
 * Data do primeiro commit depois de `since` (TEXT UTC do schema), ou null.
 * Puro: recebe os commits do dossiê, não fala com o GitHub.
 */
export function firstCommitAfter(commits: { date: string }[], since: Date): string | null {
  let best: string | null = null;
  for (const c of commits) {
    if (!c?.date) continue;
    const t = utc(c.date).getTime();
    if (Number.isNaN(t) || t <= since.getTime()) continue;
    if (!best || c.date < best) best = c.date;
  }
  return best;
}

/** o continuedAt do time: primeiro commit depois do fim da edição + 30 dias */
export function continuedAtFor(commits: { date: string }[], endsAt: Date): string | null {
  return firstCommitAfter(commits, new Date(endsAt.getTime() + CONTINUED_AFTER_DAYS * DAY));
}

/** fim da edição: endsAt; sem ele, o prazo de entrega */
export function editionEnd(h: { endsAt?: string | null; submissionDeadline?: string | null }): Date | null {
  return parseEventTime(h.endsAt ?? null) ?? parseEventTime(h.submissionDeadline ?? null);
}

export type ContinuityCandidate = { teamId: number; endsAt: Date };

/**
 * Times com repositório de edição encerrada entre 30 e 400 dias atrás, os
 * mais antigos primeiro, no máximo `limit`. Pula quem teve o dossiê coletado
 * nos últimos CONTINUITY_RECOLLECT_DAYS (o cron é mensal; sem isso os mesmos
 * 50 times gastariam a cota do GitHub toda execução).
 */
export async function continuityCandidates(now: Date = new Date(), limit = CONTINUITY_LIMIT): Promise<ContinuityCandidate[]> {
  const rows = await db
    .prepare(
      `SELECT t.id AS teamId, h.endsAt, h.submissionDeadline, d.collectedAt
       FROM teams t
       JOIN hackathons h ON h.id = t.hackathonId
       JOIN team_projects tp ON tp.teamId = t.id
       LEFT JOIN project_dossiers d ON d.teamId = t.id
       WHERE tp.repoUrl IS NOT NULL AND btrim(tp.repoUrl) <> ''`,
    )
    .all<{ teamId: number; endsAt: string | null; submissionDeadline: string | null; collectedAt: string | null }>();
  const out: ContinuityCandidate[] = [];
  for (const r of rows) {
    const end = editionEnd(r);
    if (!end) continue;
    const age = now.getTime() - end.getTime();
    if (age < CONTINUITY_MIN_DAYS * DAY || age > CONTINUITY_MAX_DAYS * DAY) continue;
    if (r.collectedAt) {
      const collected = utc(r.collectedAt).getTime();
      if (!Number.isNaN(collected) && now.getTime() - collected < CONTINUITY_RECOLLECT_DAYS * DAY) continue;
    }
    out.push({ teamId: Number(r.teamId), endsAt: end });
  }
  return out.sort((a, b) => a.endsAt.getTime() - b.endsAt.getTime() || a.teamId - b.teamId).slice(0, Math.max(1, limit));
}

/** grava o selo uma vez só: o primeiro commit depois da janela manda */
async function markContinued(teamId: number, at: string): Promise<boolean> {
  const r = await db
    .prepare("UPDATE team_projects SET continuedAt = ? WHERE teamId = ? AND continuedAt IS NULL")
    .run(at, teamId);
  return r.changes > 0;
}

export type ContinuityRun = {
  /** times que entraram na janela nesta execução */
  candidates: number;
  /** dossiês coletados com sucesso */
  collected: number;
  /** times que ganharam o selo agora */
  continued: number;
  /** coleta que falhou (motivo fica no dossiê) */
  failed: number;
};

/**
 * O cron. Re-coleta o dossiê de cada candidato (collectDossierQuietly nunca
 * derruba a execução: o erro fica gravado no dossiê) e grava o selo quando
 * existe commit depois do fim da edição + 30 dias. Idempotente.
 */
export async function runContinuity(
  opts: { now?: Date; limit?: number; fetch?: FetchOpts } = {},
): Promise<ContinuityRun> {
  const now = opts.now ?? new Date();
  const candidates = await continuityCandidates(now, opts.limit);
  const run: ContinuityRun = { candidates: candidates.length, collected: 0, continued: 0, failed: 0 };
  for (const c of candidates) {
    await collectDossierQuietly(c.teamId, opts.fetch);
    const row = await db
      .prepare("SELECT commits, collectedAt FROM project_dossiers WHERE teamId = ?")
      .get<{ commits: string | null; collectedAt: string | null }>(c.teamId);
    if (!row?.collectedAt) {
      run.failed++;
      continue;
    }
    run.collected++;
    const at = continuedAtFor(parseCommits(row.commits), c.endsAt);
    if (at && (await markContinued(c.teamId, at))) run.continued++;
  }
  return run;
}

// ---------- continuação entre edições ----------

export type PreviousProject = {
  teamId: number;
  title: string;
  hackathonId: string;
  hackathonName: string;
};

/**
 * Projetos de outras edições em que a pessoa fez parte — as opções do "este
 * projeto continua" no editor da entrega. Só time com projeto (título).
 */
export async function previousProjects(username: string, hackathonId: string): Promise<PreviousProject[]> {
  return db
    .prepare(
      `SELECT t.id AS teamId, tp.title, t.hackathonId, h.name AS "hackathonName"
       FROM team_members tm
       JOIN teams t ON t.id = tm.teamId
       JOIN team_projects tp ON tp.teamId = t.id
       JOIN hackathons h ON h.id = t.hackathonId
       WHERE tm.username = ? AND t.hackathonId <> ?
       ORDER BY to_ts(h.startsAt) DESC, t.id DESC
       LIMIT 50`,
    )
    .all<PreviousProject>(username, hackathonId);
}

/** o projeto anterior que este continua (null quando não é continuação) */
export async function continuesOf(teamId: number): Promise<PreviousProject | null> {
  return (
    (await db
      .prepare(
        `SELECT t.id AS teamId, tp.title, t.hackathonId, h.name AS "hackathonName"
         FROM team_projects atual
         JOIN teams t ON t.id = atual.continuesTeamId
         JOIN team_projects tp ON tp.teamId = t.id
         JOIN hackathons h ON h.id = t.hackathonId
         WHERE atual.teamId = ?`,
      )
      .get<PreviousProject>(teamId)) ?? null
  );
}

/**
 * O time da continuação é válido pra quem está enviando? Mora em
 * lib/entries.ts (continuesProjectOf): lib/entries não pode importar daqui
 * sem ciclo (dossier → entries).
 */
