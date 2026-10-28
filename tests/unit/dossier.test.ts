import { describe, expect, it, vi } from "vitest";
import { buildTimeline, eventWindow, phaseOf } from "@/lib/dossier";
import { missingRequired, parseSnapshot, validateDraftPatch, type EntryFields } from "@/lib/entries";
import {
  fetchRepoCommits,
  githubDateToDb,
  lastPageFromLink,
  parseGithubRepo,
  type GithubCommit,
} from "@/lib/githubCommits";

// dossiê de evidência (migration 029): partes puras + cliente do GitHub com
// fetch falso (nunca rede de verdade).

const c = (date: string, i = 0): GithubCommit => ({ sha: `${i}`.padStart(7, "a"), date, author: "x", message: "m" });

describe("parseGithubRepo", () => {
  it("aceita as formas comuns de link do GitHub", () => {
    expect(parseGithubRepo("https://github.com/dono/repo")).toEqual({ owner: "dono", repo: "repo" });
    expect(parseGithubRepo("https://github.com/dono/repo.git")).toEqual({ owner: "dono", repo: "repo" });
    expect(parseGithubRepo("https://www.github.com/dono/repo/tree/main/src")).toEqual({ owner: "dono", repo: "repo" });
    expect(parseGithubRepo("  http://GitHub.com/Dono-1/re.po_x  ")).toEqual({ owner: "Dono-1", repo: "re.po_x" });
  });

  it("recusa o que não é repositório do github.com", () => {
    for (const u of [
      null,
      "",
      "github.com/dono/repo",
      "https://gitlab.com/dono/repo",
      "https://github.com/dono",
      "https://github.com.evil.dev/dono/repo",
      "ftp://github.com/dono/repo",
      "https://github.com/dono/..",
      "https://github.com/do no/repo",
    ]) {
      expect(parseGithubRepo(u), String(u)).toBeNull();
    }
  });
});

describe("utilitários do cliente", () => {
  it("lastPageFromLink lê rel=last", () => {
    const link =
      '<https://api.github.com/repositories/1/commits?per_page=100&page=2>; rel="next", ' +
      '<https://api.github.com/repositories/1/commits?per_page=100&page=7>; rel="last"';
    expect(lastPageFromLink(link)).toBe(7);
    expect(lastPageFromLink('<https://x?page=2>; rel="next"')).toBeNull();
    expect(lastPageFromLink(null)).toBeNull();
  });

  it("githubDateToDb converte ISO com fuso pra UTC do schema", () => {
    expect(githubDateToDb("2026-10-20T12:00:00Z")).toBe("2026-10-20 12:00:00");
    expect(githubDateToDb("2026-10-20T09:30:00-03:00")).toBe("2026-10-20 12:30:00");
    expect(githubDateToDb("lixo")).toBeNull();
    expect(githubDateToDb(42)).toBeNull();
  });
});

describe("janela do evento e linha do tempo", () => {
  const w = eventWindow({
    startsAt: "2026-10-20T09:00",
    endsAt: "2026-10-21",
    submissionDeadline: "2026-10-21 18:00:00",
    submissionGraceMinutes: 5,
  });

  it("início em Brasília; fim = prazo + tolerância", () => {
    expect(w.start?.toISOString()).toBe("2026-10-20T12:00:00.000Z");
    expect(w.end?.toISOString()).toBe("2026-10-21T18:05:00.000Z");
  });

  it("sem prazo: endsAt de data pura vale até 23:59:59 de Brasília", () => {
    const w2 = eventWindow({ startsAt: "2026-10-20", endsAt: "2026-10-21" });
    expect(w2.end?.toISOString()).toBe("2026-10-22T02:59:59.000Z");
    expect(eventWindow({ startsAt: "2026-10-20", endsAt: null }).end).toBeNull();
  });

  it("phaseOf separa antes, durante e depois", () => {
    expect(phaseOf("2026-10-20 11:59:59", w)).toBe("antes");
    expect(phaseOf("2026-10-20 12:00:00", w)).toBe("durante");
    expect(phaseOf("2026-10-21 18:05:00", w)).toBe("durante");
    expect(phaseOf("2026-10-21 18:05:01", w)).toBe("depois");
  });

  it("maioria antes + repositório antigo + depois do prazo viram sinais", () => {
    const commits = [
      c("2026-10-22 10:00:00", 1),
      c("2026-10-20 15:00:00", 2),
      c("2025-03-01 10:00:00", 3),
      c("2025-02-01 10:00:00", 4),
      c("2025-01-01 10:00:00", 5),
    ];
    const t = buildTimeline(commits, w, { repoCreatedAt: "2024-12-31 10:00:00", totalCommits: 5 });
    expect([t.before, t.during, t.after, t.counted]).toEqual([3, 1, 1, 5]);
    expect(t.firstCommitAt).toBe("2025-01-01 10:00:00");
    expect(t.lastCommitAt).toBe("2026-10-22 10:00:00");
    expect(t.signals.map((s) => s.key)).toEqual(["repo_antes", "maioria_antes", "depois_prazo"]);
    expect(t.signals[0].text).toBe("repositório criado antes do evento (31/12/2024)");
    expect(t.signals[1].text).toBe("maioria dos commits antes do início (3 de 5)");
  });

  it("minoria antes = só 'primeiro commit antes'; tudo dentro = nenhum sinal", () => {
    const some = buildTimeline(
      [c("2026-10-20 13:00:00", 1), c("2026-10-20 14:00:00", 2), c("2026-10-20 15:00:00", 3), c("2026-10-19 10:00:00", 4)],
      w,
    );
    expect(some.signals.map((s) => s.key)).toEqual(["primeiro_antes"]);
    const clean = buildTimeline([c("2026-10-20 13:00:00", 1), c("2026-10-20 14:00:00", 2), c("2026-10-21 10:00:00", 3)], w, {
      repoCreatedAt: "2026-10-20 12:30:00",
    });
    expect(clean.signals).toEqual([]);
  });

  it("um ou dois commits no total e fork também sinalizam", () => {
    const one = buildTimeline([c("2026-10-20 13:00:00")], w, { totalCommits: 1, forkOf: "outra/base" });
    expect(one.signals.map((s) => s.key)).toEqual(["fork", "poucos_commits"]);
    expect(one.signals[0].text).toBe("repositório é fork de outra/base");
    // totalCommits grande (repositório truncado) não dispara "poucos"
    expect(buildTimeline([c("2026-10-20 13:00:00")], w, { totalCommits: 900 }).signals).toEqual([]);
  });

  it("sem commits: tudo zero, sem sinal", () => {
    const t = buildTimeline([], w);
    expect(t).toMatchObject({ before: 0, during: 0, after: 0, counted: 0, firstCommitAt: null, signals: [] });
  });
});

describe("declaração na entrega", () => {
  const base: EntryFields = {
    title: "x",
    tagline: "y",
    description: "z",
    repoUrl: null,
    demoUrl: null,
    videoUrl: null,
    slidesUrl: null,
    logoUrl: null,
    priorWork: null,
    technologies: ["Go"],
    links: [],
    socialPosts: [],
    aiUsage: null,
    challengeIds: [],
    priorExisted: null,
    usedAi: null,
  };

  it("valida sim/não/nulo", () => {
    expect(validateDraftPatch({ priorExisted: true, usedAi: false })).toEqual({ priorExisted: true, usedAi: false });
    expect(validateDraftPatch({ priorExisted: null })).toEqual({ priorExisted: null });
    expect(() => validateDraftPatch({ usedAi: "sim" })).toThrow(/usedAi/);
  });

  it("'não existia nada' dispensa o texto do trabalho anterior", () => {
    expect(missingRequired(base, null)).toContain("trabalho anterior");
    expect(missingRequired({ ...base, priorExisted: true }, null)).toContain("trabalho anterior");
    expect(missingRequired({ ...base, priorExisted: false }, null)).not.toContain("trabalho anterior");
  });

  it("snapshot antigo sem declaração vira null", () => {
    const s = parseSnapshot(JSON.stringify({ title: "a" }));
    expect(s.priorExisted).toBeNull();
    expect(s.usedAi).toBeNull();
    expect(parseSnapshot(JSON.stringify({ title: "a", priorExisted: true, usedAi: false }))).toMatchObject({
      priorExisted: true,
      usedAi: false,
    });
  });
});

// ---------- cliente do GitHub com fetch falso ----------

const ok = (body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json", ...headers } });
const status = (code: number, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ message: "x" }), { status: code, headers });
const raw = (i: number, iso: string) => ({
  sha: i.toString(16).padStart(40, "0"),
  commit: { author: { name: `Nome ${i}`, date: iso }, message: `commit ${i}\n\ncorpo longo` },
  author: i % 2 ? { login: `dev${i}` } : null,
});
const repoBody = { full_name: "dono/repo", private: false, visibility: "public", fork: false, default_branch: "main", created_at: "2026-10-01T10:00:00Z", pushed_at: "2026-10-21T10:00:00Z" };

describe("fetchRepoCommits (fetch falso)", () => {
  const ref = { owner: "dono", repo: "repo" };

  it("lê repositório e commits; manda token quando tem", async () => {
    const f = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) =>
      url.endsWith("/repos/dono/repo") ? ok(repoBody) : ok([raw(1, "2026-10-20T15:00:00Z"), raw(2, "2026-10-20T14:00:00Z")]),
    );
    const r = await fetchRepoCommits(ref, { fetchImpl: f, base: "https://gh.test", token: "tkn" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r).toMatchObject({ fullName: "dono/repo", createdAt: "2026-10-01 10:00:00", defaultBranch: "main", total: 2, truncated: false, forkOf: null });
    expect(r.commits[0]).toEqual({ sha: raw(1, "").sha, date: "2026-10-20 15:00:00", author: "dev1", message: "commit 1" });
    expect(r.commits[1].author).toBe("Nome 2");
    expect(f).toHaveBeenCalledTimes(2);
    const init = f.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tkn");
    expect(f.mock.calls[1][0]).toBe("https://gh.test/repos/dono/repo/commits?per_page=100&page=1");
  });

  it("sem token não manda Authorization", async () => {
    const f = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async (url) => (url.endsWith("/repo") ? ok(repoBody) : ok([raw(1, "2026-10-20T15:00:00Z")])));
    await fetchRepoCommits(ref, { fetchImpl: f, base: "https://gh.test", token: null });
    const init = f.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("até 3 páginas lê todas; mais que isso lê 2 primeiras + a última e marca truncado", async () => {
    const page = (n: number, size: number) =>
      Array.from({ length: size }, (_, i) => raw(n * 1000 + i, `2026-10-${String(20 - n).padStart(2, "0")}T10:00:00Z`));
    const link = (last: number) => ({ link: `<https://gh.test/x?per_page=100&page=2>; rel="next", <https://gh.test/x?per_page=100&page=${last}>; rel="last"` });

    const small = vi.fn(async (url: string) => {
      if (url.endsWith("/repo")) return ok(repoBody);
      const p = Number(new URL(url).searchParams.get("page"));
      return ok(page(p, p === 3 ? 40 : 100), link(3));
    });
    const r1 = await fetchRepoCommits(ref, { fetchImpl: small, base: "https://gh.test", token: null });
    expect(r1.ok && [r1.commits.length, r1.total, r1.truncated]).toEqual([240, 240, false]);

    const big = vi.fn(async (url: string) => {
      if (url.endsWith("/repo")) return ok(repoBody);
      const p = Number(new URL(url).searchParams.get("page"));
      return ok(page(p, p === 9 ? 30 : 100), link(9));
    });
    const r2 = await fetchRepoCommits(ref, { fetchImpl: big, base: "https://gh.test", token: null });
    expect(r2.ok && [r2.commits.length, r2.total, r2.truncated]).toEqual([230, 830, true]);
    const pages = big.mock.calls.map((c) => new URL(c[0]).searchParams.get("page")).filter(Boolean);
    expect(pages).toEqual(["1", "2", "9"]);
    // o primeiro commit (mais antigo) vem da última página
    expect(r2.ok && r2.commits.at(-1)!.date).toBe("2026-10-11 10:00:00");
  });

  it("404 = não encontrado ou privado", async () => {
    const r = await fetchRepoCommits(ref, { fetchImpl: async () => status(404), base: "https://gh.test" });
    expect(r).toMatchObject({ ok: false, kind: "not_found" });
    expect(!r.ok && r.message).toMatch(/não encontrado ou privado/);
  });

  it("privado visível pelo token também é recusado", async () => {
    const r = await fetchRepoCommits(ref, {
      fetchImpl: async () => ok({ ...repoBody, private: true, visibility: "private" }),
      base: "https://gh.test",
      token: "tkn",
    });
    expect(r).toMatchObject({ ok: false, kind: "private" });
  });

  it("rate limit (403 com remaining 0 ou 429) tem mensagem com horário", async () => {
    const reset = String(Math.floor(Date.UTC(2026, 9, 20, 15, 30) / 1000));
    const r = await fetchRepoCommits(ref, {
      fetchImpl: async () => status(403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": reset }),
      base: "https://gh.test",
    });
    expect(r).toMatchObject({ ok: false, kind: "rate_limited" });
    expect(!r.ok && r.message).toContain("12:30");
    const r429 = await fetchRepoCommits(ref, { fetchImpl: async () => status(429, { "retry-after": "60" }), base: "https://gh.test" });
    expect(r429).toMatchObject({ ok: false, kind: "rate_limited" });
    expect(!r429.ok && r429.message).toContain("60s");
  });

  it("repositório vazio (409) e lista vazia viram 'empty'", async () => {
    const r = await fetchRepoCommits(ref, {
      fetchImpl: async (url: string) => (url.endsWith("/repo") ? ok(repoBody) : status(409)),
      base: "https://gh.test",
    });
    expect(r).toMatchObject({ ok: false, kind: "empty" });
    const r2 = await fetchRepoCommits(ref, {
      fetchImpl: async (url: string) => (url.endsWith("/repo") ? ok(repoBody) : ok([])),
      base: "https://gh.test",
    });
    expect(r2).toMatchObject({ ok: false, kind: "empty" });
  });

  it("rede fora do ar e resposta estranha não lançam", async () => {
    const r = await fetchRepoCommits(ref, {
      fetchImpl: async () => {
        throw new TypeError("fetch failed");
      },
      base: "https://gh.test",
    });
    expect(r).toMatchObject({ ok: false, kind: "network" });
    const r2 = await fetchRepoCommits(ref, {
      fetchImpl: async (url: string) => (url.endsWith("/repo") ? ok(repoBody) : ok({ nao: "lista" })),
      base: "https://gh.test",
    });
    expect(r2).toMatchObject({ ok: false, kind: "error" });
    const r3 = await fetchRepoCommits(ref, { fetchImpl: async () => status(500), base: "https://gh.test" });
    expect(r3).toMatchObject({ ok: false, kind: "error" });
  });

  it("fork aponta o repositório de origem", async () => {
    const r = await fetchRepoCommits(ref, {
      fetchImpl: async (url: string) =>
        url.endsWith("/repo") ? ok({ ...repoBody, fork: true, parent: { full_name: "base/orig" } }) : ok([raw(1, "2026-10-20T15:00:00Z")]),
      base: "https://gh.test",
    });
    expect(r.ok && r.forkOf).toBe("base/orig");
  });
});
