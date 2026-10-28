import db from "@/lib/db";
import { parseEventTime, spWallTime } from "@/lib/eventTime";
import { EntryError, parseSnapshot, toDbTime } from "@/lib/entries";
import {
  fetchRepoCommits,
  parseGithubRepo,
  type FetchOpts,
  type GithubCommit,
  type GithubErrorKind,
  NEWEST_KEPT,
} from "@/lib/githubCommits";

// Dossiê de evidência do projeto (roadmap 037 #10, migration 029).
//
// Linha do tempo dos commits do repositório público contra a janela do
// evento (início → prazo de entrega), mais a declaração do time ("já
// existia algo antes?", "usou IA?"). REGRA: só sinaliza. Nada aqui
// desclassifica, dá nota ou esconde time do júri; a decisão é do
// organizador. Data de commit vem do git e quem commita pode editar, então
// cada sinal é indício pra conversa com o time.

// ---------- janela do evento ----------

export type EventWindow = { start: Date | null; end: Date | null };

/**
 * Início = startsAt da edição. Fim = prazo de entrega + tolerância; sem
 * prazo, endsAt (data pura vale até 23:59 de Brasília daquele dia).
 */
export function eventWindow(h: {
  startsAt: string | null;
  endsAt: string | null;
  submissionDeadline?: string | null;
  submissionGraceMinutes?: number | null;
}): EventWindow {
  const start = parseEventTime(h.startsAt);
  const deadline = parseEventTime(h.submissionDeadline ?? null);
  let end: Date | null = null;
  if (deadline) {
    end = new Date(deadline.getTime() + (h.submissionGraceMinutes ?? 0) * 60_000);
  } else if (h.endsAt) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(h.endsAt.trim());
    end = m ? spWallTime(+m[1], +m[2], +m[3], 23, 59, 59) : parseEventTime(h.endsAt);
  }
  return { start, end };
}

// ---------- linha do tempo (puro) ----------

export type Phase = "antes" | "durante" | "depois";

export type SignalKey = "repo_antes" | "maioria_antes" | "primeiro_antes" | "poucos_commits" | "fork" | "depois_prazo";

export type Signal = { key: SignalKey; text: string };

export type Timeline = {
  before: number;
  during: number;
  after: number;
  /** commits lidos (até 300); o total do repositório está em totalCommits */
  counted: number;
  /**
   * commits do meio de repositório grande que não foram lidos, mas entram em
   * antes/durante/depois pela data dos vizinhos (0 = nenhum)
   */
  inferred: number;
  /** a janela corta o meio não lido: a divisão dele é estimativa por data */
  estimated: boolean;
  firstCommitAt: string | null;
  lastCommitAt: string | null;
  signals: Signal[];
};

const utc = (v: string) => new Date(`${v.replace(" ", "T")}Z`);

export function phaseOf(date: string, w: EventWindow): Phase {
  const t = utc(date).getTime();
  if (w.start && t < w.start.getTime()) return "antes";
  if (w.end && t > w.end.getTime()) return "depois";
  return "durante";
}

const dayFmt = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  timeZone: "America/Sao_Paulo",
});
export const formatDay = (v: string | null) => (v ? dayFmt.format(utc(v)) : "");

/**
 * Repositório grande (mais de 300 commits): a coleta lê as 2 páginas mais
 * novas e a mais antiga, e o meio fica de fora. Os commits do meio são todos
 * mais velhos que o mais antigo das páginas novas (`hi`) e mais novos que o
 * mais novo da página antiga (`lo`). Se `lo` e `hi` caem na mesma fase, o meio
 * inteiro é dessa fase (conta exata). Se a janela corta o meio, divide pelo
 * tempo, supondo ritmo constante de commits entre `lo` e `hi` (estimativa).
 */
export function splitUnread(
  n: number,
  lo: string,
  hi: string,
  w: EventWindow,
): { antes: number; durante: number; depois: number; estimated: boolean } {
  const zero = { antes: 0, durante: 0, depois: 0 };
  if (n <= 0) return { ...zero, estimated: false };
  const pLo = phaseOf(lo, w);
  const pHi = phaseOf(hi, w);
  if (pLo === pHi) return { ...zero, [pLo]: n, estimated: false };
  const tLo = utc(lo).getTime();
  const tHi = utc(hi).getTime();
  const span = tHi - tLo;
  const frac = (t: number) => (span > 0 ? Math.min(1, Math.max(0, (t - tLo) / span)) : 0.5);
  const antes = w.start ? Math.round(n * frac(w.start.getTime())) : 0;
  const depois = w.end ? Math.min(n - antes, Math.round(n * (1 - frac(w.end.getTime())))) : 0;
  return { antes, durante: n - antes - depois, depois, estimated: true };
}

/**
 * Conta antes/durante/depois e levanta os sinais. Puro e testável.
 * `repoCreatedAt`/`forkOf`/`totalCommits`/`truncated` vêm da coleta.
 */
export function buildTimeline(
  commits: GithubCommit[],
  w: EventWindow,
  repo: {
    repoCreatedAt?: string | null;
    forkOf?: string | null;
    totalCommits?: number;
    truncated?: boolean | number;
  } = {},
): Timeline {
  let before = 0;
  let during = 0;
  let after = 0;
  let first: string | null = null;
  let last: string | null = null;
  for (const c of commits) {
    const p = phaseOf(c.date, w);
    if (p === "antes") before++;
    else if (p === "depois") after++;
    else during++;
    if (!first || c.date < first) first = c.date;
    if (!last || c.date > last) last = c.date;
  }
  const counted = commits.length;
  const total = Math.max(repo.totalCommits ?? counted, counted);
  let inferred = 0;
  let estimated = false;
  if (repo.truncated && total > counted && counted > NEWEST_KEPT) {
    const hi = commits.slice(0, NEWEST_KEPT).reduce((m, c) => (c.date < m ? c.date : m), commits[0].date);
    const lo = commits.slice(NEWEST_KEPT).reduce((m, c) => (c.date > m ? c.date : m), commits[NEWEST_KEPT].date);
    const gap = splitUnread(total - counted, lo, hi, w);
    before += gap.antes;
    during += gap.durante;
    after += gap.depois;
    inferred = total - counted;
    estimated = gap.estimated;
  }
  const all = before + during + after;
  const signals: Signal[] = [];
  if (repo.repoCreatedAt && w.start && utc(repo.repoCreatedAt).getTime() < w.start.getTime()) {
    signals.push({ key: "repo_antes", text: `repositório criado antes do evento (${formatDay(repo.repoCreatedAt)})` });
  }
  if (repo.forkOf) {
    signals.push({
      key: "fork",
      text: repo.forkOf === "?" ? "repositório é fork de outro" : `repositório é fork de ${repo.forkOf}`,
    });
  }
  if (all > 0 && before * 2 > all) {
    signals.push({
      key: "maioria_antes",
      text: `maioria dos commits antes do início (${estimated ? "cerca de " : ""}${before} de ${all})`,
    });
  } else if (before > 0 && first) {
    signals.push({ key: "primeiro_antes", text: `primeiro commit antes do início (${formatDay(first)})` });
  }
  if (total > 0 && total <= 2) {
    signals.push({
      key: "poucos_commits",
      text: total === 1 ? "um commit só: o código pode ter chegado de uma vez" : "dois commits só: o código pode ter chegado de uma vez",
    });
  }
  if (after > 0) {
    signals.push({
      key: "depois_prazo",
      text: `${after} ${after === 1 ? "commit" : "commits"} depois do prazo (o júri avalia a versão enviada até o prazo)`,
    });
  }
  return { before, during, after, counted, inferred, estimated, firstCommitAt: first, lastCommitAt: last, signals };
}

// ---------- banco ----------

type DossierRow = {
  teamId: number;
  repoUrl: string;
  repoFullName: string | null;
  repoCreatedAt: string | null;
  repoPushedAt: string | null;
  forkOf: string | null;
  defaultBranch: string | null;
  totalCommits: number;
  truncated: number;
  commits: string;
  collectedAt: string | null;
  attemptedAt: string;
  errorKind: GithubErrorKind | null;
  errorMessage: string | null;
  collectedBy: number | null;
};

const parseCommits = (v: string): GithubCommit[] => {
  try {
    const a = JSON.parse(v);
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
};

/**
 * coleta automática: no máximo uma por time nesse intervalo, mesmo trocando o
 * repositório (trocar o link entre A e B a cada envio não gasta a cota do
 * GitHub, que sem GITHUB_TOKEN é 60/h pro servidor inteiro)
 */
export const AUTO_COOLDOWN_MS = 5 * 60_000;
/** botão "atualizar" do painel: no mínimo isso entre duas coletas do mesmo time */
export const MANUAL_COOLDOWN_MS = 60_000;

/** repositório que vale pro dossiê: o da última versão enviada; sem envio, o do rascunho */
async function repoUrlOf(teamId: number): Promise<string | null> {
  const snap = await db
    .prepare("SELECT snapshot FROM project_submissions WHERE teamId = ? ORDER BY version DESC LIMIT 1")
    .get<{ snapshot: string }>(teamId);
  if (snap) return parseSnapshot(snap.snapshot).repoUrl;
  const p = await db.prepare("SELECT repoUrl FROM team_projects WHERE teamId = ?").get<{ repoUrl: string | null }>(teamId);
  return p?.repoUrl ?? null;
}

export type CollectResult =
  | { status: "ok"; commits: number }
  | { status: "error"; kind: GithubErrorKind; message: string }
  | { status: "skipped"; reason: "sem_repo" | "recente" };

/**
 * Lê o GitHub e grava a foto do time. Falha não apaga a última foto boa do
 * mesmo repositório: só registra o motivo. Repositório trocado zera a foto.
 * `manual` = botão do painel (cooldown curto, grava quem pediu);
 * automático = no envio da entrega (pula se o time tentou há menos de 5 min,
 * qualquer que seja o repositório).
 */
export async function collectDossier(
  teamId: number,
  opts: { actorId?: number | null; manual?: boolean; now?: Date; fetch?: FetchOpts } = {},
): Promise<CollectResult> {
  const now = opts.now ?? new Date();
  const repoUrl = await repoUrlOf(teamId);
  if (!repoUrl) return { status: "skipped", reason: "sem_repo" };
  const prev = await db
    .prepare("SELECT repoUrl, attemptedAt FROM project_dossiers WHERE teamId = ?")
    .get<{ repoUrl: string; attemptedAt: string }>(teamId);
  const sameRepo = prev?.repoUrl === repoUrl;
  // manual: cooldown só no mesmo repositório (o organizador vê o link novo na
  // hora; o limite por pessoa segura o resto). Automático: por time.
  if (prev && (sameRepo || !opts.manual)) {
    const age = now.getTime() - utc(prev.attemptedAt).getTime();
    const cooldown = opts.manual ? MANUAL_COOLDOWN_MS : AUTO_COOLDOWN_MS;
    if (age < cooldown) {
      if (opts.manual) {
        const wait = Math.max(1, Math.ceil((cooldown - age) / 1000));
        throw new EntryError(`dossiê atualizado agora há pouco. Tente de novo em ${wait}s.`, 429);
      }
      return { status: "skipped", reason: "recente" };
    }
  }

  const ref = parseGithubRepo(repoUrl);
  const result = ref
    ? await fetchRepoCommits(ref, opts.fetch)
    : ({
        ok: false,
        kind: "invalid",
        message: "O link do repositório não é do GitHub. O dossiê só lê repositório público do github.com.",
      } as const);
  const at = toDbTime(now);
  const actor = opts.actorId ?? null;

  if (result.ok) {
    await db
      .prepare(
        `INSERT INTO project_dossiers (teamId, repoUrl, repoFullName, repoCreatedAt, repoPushedAt, forkOf, defaultBranch,
           totalCommits, truncated, commits, collectedAt, attemptedAt, errorKind, errorMessage, collectedBy)
         VALUES (@teamId, @repoUrl, @fullName, @createdAt, @pushedAt, @forkOf, @branch, @total, @truncated, @commits,
           @at, @at, NULL, NULL, @actor)
         ON CONFLICT (teamId) DO UPDATE SET repoUrl = excluded.repoUrl, repoFullName = excluded.repoFullName,
           repoCreatedAt = excluded.repoCreatedAt, repoPushedAt = excluded.repoPushedAt, forkOf = excluded.forkOf,
           defaultBranch = excluded.defaultBranch, totalCommits = excluded.totalCommits, truncated = excluded.truncated,
           commits = excluded.commits, collectedAt = excluded.collectedAt, attemptedAt = excluded.attemptedAt,
           errorKind = NULL, errorMessage = NULL, collectedBy = excluded.collectedBy`,
      )
      .run({
        teamId,
        repoUrl,
        fullName: result.fullName,
        createdAt: result.createdAt,
        pushedAt: result.pushedAt,
        forkOf: result.forkOf,
        branch: result.defaultBranch,
        total: result.total,
        truncated: result.truncated ? 1 : 0,
        commits: JSON.stringify(result.commits),
        at,
        actor,
      });
    return { status: "ok", commits: result.commits.length };
  }

  if (prev && sameRepo) {
    await db
      .prepare(
        "UPDATE project_dossiers SET attemptedAt = ?, errorKind = ?, errorMessage = ?, collectedBy = ? WHERE teamId = ?",
      )
      .run(at, result.kind, result.message, actor, teamId);
  } else {
    await db
      .prepare(
        `INSERT INTO project_dossiers (teamId, repoUrl, attemptedAt, errorKind, errorMessage, collectedBy)
         VALUES (@teamId, @repoUrl, @at, @kind, @message, @actor)
         ON CONFLICT (teamId) DO UPDATE SET repoUrl = excluded.repoUrl, repoFullName = NULL, repoCreatedAt = NULL,
           repoPushedAt = NULL, forkOf = NULL, defaultBranch = NULL, totalCommits = 0, truncated = 0, commits = '[]',
           collectedAt = NULL, attemptedAt = excluded.attemptedAt, errorKind = excluded.errorKind,
           errorMessage = excluded.errorMessage, collectedBy = excluded.collectedBy`,
      )
      .run({ teamId, repoUrl, at, kind: result.kind, message: result.message, actor });
  }
  return { status: "error", kind: result.kind, message: result.message };
}

/**
 * Coleta automática no envio da entrega: nunca derruba o envio. Erro do
 * GitHub fica gravado no dossiê; erro inesperado só vai pro log.
 */
export async function collectDossierQuietly(teamId: number, fetchOpts?: FetchOpts): Promise<void> {
  try {
    await collectDossier(teamId, { fetch: fetchOpts });
  } catch (e) {
    console.error("[dossie] coleta automática falhou", teamId, e);
  }
}

// ---------- painel do organizador ----------

export type Declaration = {
  /** null = não respondeu */
  priorExisted: boolean | null;
  priorWork: string | null;
  usedAi: boolean | null;
  aiUsage: string | null;
};

export type TeamDossier = {
  teamId: number;
  teamName: string;
  title: string | null;
  /** repositório que o dossiê lê agora (última versão enviada ou rascunho) */
  repoUrl: string | null;
  submitted: boolean;
  declaration: Declaration;
  collection: {
    repoUrl: string;
    repoFullName: string | null;
    repoCreatedAt: string | null;
    forkOf: string | null;
    defaultBranch: string | null;
    totalCommits: number;
    truncated: boolean;
    collectedAt: string | null;
    attemptedAt: string;
    error: { kind: GithubErrorKind; message: string } | null;
    /** a foto é de outro repositório (o time trocou o link depois) */
    stale: boolean;
    commits: (GithubCommit & { phase: Phase })[];
    timeline: Timeline;
  } | null;
};

const bool = (v: number | null | undefined) => (v === null || v === undefined ? null : v === 1);

/** dossiê de todos os times da edição — 4 queries, não 4 por time */
export async function listDossiers(hackathonId: string): Promise<{ window: EventWindow; teams: TeamDossier[] }> {
  const [h, teams, projects, snapshots, dossiers] = await Promise.all([
    db
      .prepare("SELECT startsAt, endsAt, submissionDeadline, submissionGraceMinutes FROM hackathons WHERE id = ?")
      .get<{ startsAt: string; endsAt: string | null; submissionDeadline: string | null; submissionGraceMinutes: number }>(
        hackathonId,
      ),
    db.prepare("SELECT id, name FROM teams WHERE hackathonId = ? ORDER BY name").all<{ id: number; name: string }>(hackathonId),
    db
      .prepare(
        `SELECT tp.teamId, tp.title, tp.repoUrl, tp.priorWork, tp.aiUsage, tp.priorExisted, tp.usedAi
         FROM team_projects tp JOIN teams t ON t.id = tp.teamId WHERE t.hackathonId = ?`,
      )
      .all<{
        teamId: number;
        title: string;
        repoUrl: string | null;
        priorWork: string | null;
        aiUsage: string | null;
        priorExisted: number | null;
        usedAi: number | null;
      }>(hackathonId),
    db
      .prepare(
        `SELECT DISTINCT ON (ps.teamId) ps.teamId, ps.snapshot FROM project_submissions ps
         JOIN teams t ON t.id = ps.teamId WHERE t.hackathonId = ?
         ORDER BY ps.teamId, ps.version DESC`,
      )
      .all<{ teamId: number; snapshot: string }>(hackathonId),
    db
      .prepare("SELECT d.* FROM project_dossiers d JOIN teams t ON t.id = d.teamId WHERE t.hackathonId = ?")
      .all<DossierRow>(hackathonId),
  ]);
  const window = h ? eventWindow(h) : { start: null, end: null };
  const projectBy = new Map(projects.map((p) => [p.teamId, p]));
  const snapBy = new Map(snapshots.map((s) => [s.teamId, parseSnapshot(s.snapshot)]));
  const dossierBy = new Map(dossiers.map((d) => [d.teamId, d]));

  return {
    window,
    teams: teams.map((t) => {
      const p = projectBy.get(t.id);
      const snap = snapBy.get(t.id);
      // declaração: a da versão enviada; sem envio, a do rascunho
      const declaration: Declaration = snap
        ? { priorExisted: snap.priorExisted, priorWork: snap.priorWork, usedAi: snap.usedAi, aiUsage: snap.aiUsage }
        : {
            priorExisted: bool(p?.priorExisted),
            priorWork: p?.priorWork ?? null,
            usedAi: bool(p?.usedAi),
            aiUsage: p?.aiUsage ?? null,
          };
      const repoUrl = snap ? snap.repoUrl : (p?.repoUrl ?? null);
      const d = dossierBy.get(t.id);
      let collection: TeamDossier["collection"] = null;
      if (d) {
        const commits = parseCommits(d.commits);
        collection = {
          repoUrl: d.repoUrl,
          repoFullName: d.repoFullName,
          repoCreatedAt: d.repoCreatedAt,
          forkOf: d.forkOf,
          defaultBranch: d.defaultBranch,
          totalCommits: d.totalCommits,
          truncated: d.truncated === 1,
          collectedAt: d.collectedAt,
          attemptedAt: d.attemptedAt,
          error: d.errorKind ? { kind: d.errorKind, message: d.errorMessage ?? "" } : null,
          stale: !!repoUrl && repoUrl !== d.repoUrl,
          commits: commits.map((c) => ({ ...c, phase: phaseOf(c.date, window) })),
          timeline: buildTimeline(commits, window, d),
        };
      }
      return {
        teamId: t.id,
        teamName: t.name,
        title: snap?.title ?? p?.title ?? null,
        repoUrl,
        submitted: !!snap,
        declaration,
        collection,
      };
    }),
  };
}

/** o time é desta edição? (rota do botão "atualizar") */
export async function assertEditionTeam(hackathonId: string, teamId: number): Promise<void> {
  const ok =
    Number.isInteger(teamId) &&
    (await db.prepare("SELECT 1 FROM teams WHERE id = ? AND hackathonId = ?").get(teamId, hackathonId));
  if (!ok) throw new EntryError("time não encontrado", 404);
}
