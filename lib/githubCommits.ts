// Leitura de commits de repositório PÚBLICO do GitHub pro dossiê (migration
// 029). Só a API REST pública: GET /repos/{o}/{r} e /repos/{o}/{r}/commits.
// GITHUB_TOKEN é opcional (sobe o limite de 60 pra 5.000 req/h); mesmo com
// token, repositório privado é recusado — o dossiê só lê o que é público.
//
// Sem banco aqui: recebe o fetch por parâmetro, então os testes passam um
// mock e nunca tocam a rede. Base da API vem de HACKAHUB_GITHUB_API (o e2e
// aponta pra um servidor falso local); padrão https://api.github.com.

export type RepoRef = { owner: string; repo: string };

export type GithubCommit = {
  sha: string;
  /** UTC "YYYY-MM-DD HH:MM:SS" — data de autoria do git */
  date: string;
  author: string;
  /** primeira linha da mensagem, até 120 caracteres */
  message: string;
};

export type GithubErrorKind = "invalid" | "not_found" | "private" | "rate_limited" | "empty" | "network" | "error";

export type RepoCommits =
  | {
      ok: true;
      fullName: string;
      createdAt: string | null;
      pushedAt: string | null;
      defaultBranch: string | null;
      forkOf: string | null;
      commits: GithubCommit[];
      total: number;
      truncated: boolean;
    }
  | { ok: false; kind: GithubErrorKind; message: string };

export const MAX_COMMITS = 300;
const PER_PAGE = 100;
/** repositório truncado: os commits[0..NEWEST_KEPT) são os mais novos; o resto, a página mais antiga */
export const NEWEST_KEPT = 2 * PER_PAGE;
const NAME = /^[A-Za-z0-9_.-]{1,100}$/;

/** "https://github.com/dono/repo(.git)(/tree/…)" → {owner, repo}; o resto é null */
export function parseGithubRepo(url: string | null | undefined): RepoRef | null {
  if (!url) return null;
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol)) return null;
  if (!/^(www\.)?github\.com$/i.test(u.hostname)) return null;
  const [owner, rawRepo] = u.pathname.split("/").filter(Boolean);
  const repo = rawRepo?.replace(/\.git$/i, "");
  if (!owner || !repo || !NAME.test(owner) || !NAME.test(repo) || repo === "." || repo === "..") return null;
  return { owner, repo };
}

const pad = (n: number) => String(n).padStart(2, "0");
/** ISO do GitHub → TEXT UTC do schema; null se ruim */
export function githubDateToDb(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

/** número da última página no header Link (rel="last"); null sem paginação */
export function lastPageFromLink(link: string | null): number | null {
  if (!link) return null;
  for (const part of link.split(",")) {
    if (!/rel="last"/.test(part)) continue;
    const m = /[?&]page=(\d+)/.exec(part);
    if (m) return Number(m[1]);
  }
  return null;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
export type FetchOpts = { fetchImpl?: Fetch; token?: string | null; base?: string; timeoutMs?: number; now?: Date };

const brtTime = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

class GithubFail extends Error {
  constructor(
    public kind: GithubErrorKind,
    message: string,
  ) {
    super(message);
  }
}

function rateLimitFail(res: Response): GithubFail | null {
  if (res.status !== 403 && res.status !== 429) return null;
  const remaining = res.headers.get("x-ratelimit-remaining");
  const retryAfter = res.headers.get("retry-after");
  if (res.status === 429 || remaining === "0" || retryAfter) {
    const reset = Number(res.headers.get("x-ratelimit-reset"));
    const when = Number.isFinite(reset) && reset > 0
      ? ` Tente de novo depois das ${brtTime.format(new Date(reset * 1000))}.`
      : retryAfter
        ? ` Tente de novo em ${retryAfter}s.`
        : " Tente de novo em alguns minutos.";
    return new GithubFail("rate_limited", `O GitHub limitou as consultas por agora.${when}`);
  }
  return null;
}

async function call(path: string, o: Required<Pick<FetchOpts, "base" | "timeoutMs">> & FetchOpts): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "hackahub-dossie",
  };
  if (o.token) headers.Authorization = `Bearer ${o.token}`;
  const f = o.fetchImpl ?? fetch;
  try {
    return await f(`${o.base}${path}`, { headers, signal: AbortSignal.timeout(o.timeoutMs), cache: "no-store" });
  } catch {
    throw new GithubFail("network", "Não deu pra falar com o GitHub agora. Tente de novo em alguns minutos.");
  }
}

type RawCommit = {
  sha?: unknown;
  commit?: { author?: { name?: unknown; date?: unknown }; committer?: { date?: unknown }; message?: unknown };
  author?: { login?: unknown } | null;
};

function toCommit(c: RawCommit): GithubCommit | null {
  const sha = typeof c.sha === "string" ? c.sha : "";
  const date = githubDateToDb(c.commit?.author?.date) ?? githubDateToDb(c.commit?.committer?.date);
  if (!/^[0-9a-f]{7,64}$/i.test(sha) || !date) return null;
  const login = typeof c.author?.login === "string" ? c.author.login : null;
  const name = typeof c.commit?.author?.name === "string" ? c.commit.author.name : null;
  const msg = typeof c.commit?.message === "string" ? c.commit.message.split("\n")[0].trim() : "";
  return {
    sha,
    date,
    author: (login ?? name ?? "?").slice(0, 80),
    message: msg.length > 120 ? `${msg.slice(0, 119)}…` : msg,
  };
}

async function commitsPage(ref: RepoRef, page: number, o: Parameters<typeof call>[1]) {
  const res = await call(`/repos/${ref.owner}/${ref.repo}/commits?per_page=${PER_PAGE}&page=${page}`, o);
  const limited = rateLimitFail(res);
  if (limited) throw limited;
  if (res.status === 409) throw new GithubFail("empty", "O repositório está vazio: nenhum commit pra ler.");
  if (res.status === 404) throw new GithubFail("not_found", NOT_FOUND);
  if (!res.ok) throw new GithubFail("error", `O GitHub respondeu ${res.status} ao listar os commits.`);
  const body = (await res.json().catch(() => null)) as unknown;
  if (!Array.isArray(body)) throw new GithubFail("error", "Resposta inesperada do GitHub ao listar os commits.");
  return {
    commits: (body as RawCommit[]).map(toCommit).filter((c): c is GithubCommit => !!c),
    lastPage: lastPageFromLink(res.headers.get("link")),
  };
}

const NOT_FOUND = "Repositório não encontrado ou privado. O dossiê só lê repositório público do GitHub.";

/**
 * Lê o repositório e até 300 commits do branch padrão. Repositório com mais
 * de 300: os 200 mais novos + os 100 mais antigos (a primeira página e a
 * última), pra o primeiro commit ser o de verdade. Nunca lança: erro vira
 * {ok:false, kind, message} com texto pronto pra tela.
 */
export async function fetchRepoCommits(ref: RepoRef, opts: FetchOpts = {}): Promise<RepoCommits> {
  const o = {
    ...opts,
    base: (opts.base ?? process.env.HACKAHUB_GITHUB_API ?? "https://api.github.com").replace(/\/+$/, ""),
    timeoutMs: opts.timeoutMs ?? 8_000,
    token: opts.token === undefined ? process.env.GITHUB_TOKEN || null : opts.token,
  };
  try {
    const res = await call(`/repos/${ref.owner}/${ref.repo}`, o);
    const limited = rateLimitFail(res);
    if (limited) throw limited;
    if (res.status === 404 || res.status === 401) throw new GithubFail("not_found", NOT_FOUND);
    if (res.status === 451) throw new GithubFail("not_found", "O GitHub bloqueou o acesso a esse repositório.");
    if (!res.ok) throw new GithubFail("error", `O GitHub respondeu ${res.status} ao ler o repositório.`);
    const repo = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    if (!repo || typeof repo !== "object") throw new GithubFail("error", "Resposta inesperada do GitHub ao ler o repositório.");
    if (repo.private === true || (typeof repo.visibility === "string" && repo.visibility !== "public")) {
      throw new GithubFail("private", "O repositório é privado. O dossiê só lê repositório público: peça pro time abrir o código.");
    }
    const parent = repo.parent as { full_name?: unknown } | undefined;

    const first = await commitsPage(ref, 1, o);
    let commits = first.commits;
    let total = first.commits.length;
    let truncated = false;
    const last = first.lastPage ?? 1;
    if (last > 1 && last <= MAX_COMMITS / PER_PAGE) {
      for (let p = 2; p <= last; p++) commits = commits.concat((await commitsPage(ref, p, o)).commits);
      total = commits.length;
    } else if (last > MAX_COMMITS / PER_PAGE) {
      const second = await commitsPage(ref, 2, o);
      const oldest = await commitsPage(ref, last, o);
      commits = commits.concat(second.commits, oldest.commits);
      total = (last - 1) * PER_PAGE + oldest.commits.length;
      truncated = true;
    }
    if (commits.length === 0) throw new GithubFail("empty", "O repositório está vazio: nenhum commit pra ler.");
    return {
      ok: true,
      fullName: typeof repo.full_name === "string" ? repo.full_name : `${ref.owner}/${ref.repo}`,
      createdAt: githubDateToDb(repo.created_at),
      pushedAt: githubDateToDb(repo.pushed_at),
      defaultBranch: typeof repo.default_branch === "string" ? repo.default_branch : null,
      forkOf: repo.fork === true && typeof parent?.full_name === "string" ? parent.full_name : repo.fork === true ? "?" : null,
      commits,
      total,
      truncated,
    };
  } catch (e) {
    if (e instanceof GithubFail) return { ok: false, kind: e.kind, message: e.message };
    return { ok: false, kind: "error", message: "Erro inesperado ao ler o GitHub." };
  }
}
