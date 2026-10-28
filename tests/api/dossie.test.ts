import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { createTeam } from "@/lib/archive";
import { toDbTime } from "@/lib/entries";
import { rateLimit, RATE_LIMITS, resetRateLimits } from "@/lib/ratelimit";
import { grantEditionRole } from "@/lib/roles";

// Dossiê de evidência (migration 029): coleta no envio da entrega, painel do
// organizador e botão "atualizar". O GitHub é um fetch falso; nenhuma
// chamada sai pra rede.

let who: string | null = null;
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: who })),
  currentUser: vi.fn(async () => null),
}));
// a coleta do envio roda em after() (depois da resposta): aqui vira fila
const afterQueue = vi.hoisted(() => ({ jobs: [] as Promise<unknown>[] }));
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: (fn: () => unknown) => {
    afterQueue.jobs.push(Promise.resolve().then(fn));
  },
}));
/** espera o que o envio deixou pra depois da resposta */
const flush = () => Promise.all(afterQueue.jobs.splice(0));

const H = "hack-inova-alphaville-2026";
const OTHER = "hack-inova-unifacens-2026";
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const ctx = (extra: Record<string, string> = {}) => ({
  params: Promise.resolve({ id: H, ...extra } as { id: string; teamId: string }),
});
const req = (method: string, body?: unknown) =>
  new Request("http://t", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

// ---------- GitHub falso ----------
const iso = (ago: number) => new Date(Date.now() - ago).toISOString();
const commit = (i: number, ago: number) => ({
  sha: i.toString(16).padStart(40, "0"),
  commit: { author: { name: `Autor ${i}`, date: iso(ago) }, message: `commit ${i}` },
  author: { login: `dev${i}` },
});
let githubDown = false;
/** GitHub pendurado: as chamadas esperam até `release()` */
let hang: Promise<void> | null = null;
const REPOS: Record<string, { createdAgo: number; commits: unknown[] }> = {
  "time/reciclado": {
    createdAgo: 400 * DAY,
    commits: [commit(1, 2 * HOUR), commit(2, 300 * DAY), commit(3, 301 * DAY), commit(4, 302 * DAY)],
  },
  "time/limpo": { createdAgo: 20 * HOUR, commits: [commit(10, 1 * HOUR), commit(11, 3 * HOUR), commit(12, 5 * HOUR)] },
  "time/outro": { createdAgo: 10 * HOUR, commits: [commit(20, 1 * HOUR)] },
};
const github = vi.fn(async (input: string | URL | Request) => {
  if (githubDown) throw new TypeError("fetch failed");
  if (hang) await hang;
  const url = new URL(String(input));
  const m = /^\/repos\/([^/]+\/[^/]+)(\/commits)?$/.exec(url.pathname);
  const repo = m && REPOS[m[1]];
  if (!repo) return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
  if (!m[2]) {
    return Response.json({
      full_name: m[1],
      private: false,
      visibility: "public",
      fork: false,
      default_branch: "main",
      created_at: iso(repo.createdAgo),
      pushed_at: iso(0),
    });
  }
  return Response.json(url.searchParams.get("page") === "1" ? repo.commits : []);
});

const ids: Record<string, number> = {};
const teams: Record<string, number> = {};

const project = (repoUrl: string | null) => ({
  title: "Mapa da Fome",
  tagline: "onde falta comida, em mapa",
  description: "## Problema\n...",
  priorWork: "TCC de 2025",
  technologies: ["Next.js"],
  repoUrl,
  priorExisted: true,
  usedAi: false,
});

async function asTeam(username: string) {
  who = `clerk_${username}`;
  return import("@/app/api/hackathons/[id]/entry/route");
}

/** a coleta automática respeita 5 min; o teste "volta no tempo" a última tentativa */
async function age(teamId: number) {
  await db.prepare("UPDATE project_dossiers SET attemptedAt = '2000-01-01 00:00:00' WHERE teamId = ?").run(teamId);
}

beforeAll(async () => {
  vi.stubGlobal("fetch", github);
  for (const u of ["d_org", "d_staff", "d_jurado", "d_dev", "d_dev2", "d_dev3", "d_dev4", "d_admin"]) {
    await db
      .prepare("INSERT OR IGNORE INTO members (clerkId, username, email) VALUES (?, ?, ?)")
      .run(`clerk_${u}`, u, `${u}@t.dev`);
    ids[u] = (await db.prepare("SELECT id FROM members WHERE username = ?").get<{ id: number }>(u))!.id;
    await db.prepare("INSERT OR IGNORE INTO registrations (memberId, hackathonId) VALUES (?, ?)").run(ids[u], H);
  }
  await db.prepare("UPDATE members SET role = 'admin' WHERE username = 'd_admin'").run();
  await grantEditionRole(H, ids.d_org, "organizador", null);
  await grantEditionRole(H, ids.d_staff, "staff", null);
  await grantEditionRole(H, ids.d_jurado, "jurado", null);
  // janela: começou ontem, prazo em 5 h
  await db
    .prepare("UPDATE hackathons SET startsAt = ?, submissionDeadline = ?, submissionGraceMinutes = 0 WHERE id = ?")
    .run(toDbTime(new Date(Date.now() - DAY)), toDbTime(new Date(Date.now() + 5 * HOUR)), H);
  teams.reciclado = (await createTeam(H, { name: "Reciclado", placement: 0, memberUsernames: ["d_dev"] })).team.id;
  teams.limpo = (await createTeam(H, { name: "Limpo", placement: 0, memberUsernames: ["d_dev2"] })).team.id;
  teams.semRepo = (await createTeam(H, { name: "Sem Repo", placement: 0, memberUsernames: ["d_dev3"] })).team.id;
  teams.gitlab = (await createTeam(H, { name: "Gitlab", placement: 0, memberUsernames: ["d_dev4"] })).team.id;
  teams.outra = (await createTeam(OTHER, { name: "Outra Edição", placement: 0, memberUsernames: [] })).team.id;
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  resetRateLimits();
  githubDown = false;
});

async function getDossie() {
  const r = await import("@/app/api/admin/hackathons/[id]/dossie/route");
  return r.GET(req("GET"), ctx());
}

describe("permissões do dossiê", () => {
  it("401 deslogado; 403 pra staff, júri e time; 200 pra organizador e admin global", async () => {
    const list = await import("@/app/api/admin/hackathons/[id]/dossie/route");
    const one = await import("@/app/api/admin/hackathons/[id]/dossie/[teamId]/route");
    who = null;
    expect((await list.GET(req("GET"), ctx())).status).toBe(401);
    expect((await one.POST(req("POST"), ctx({ teamId: String(teams.reciclado) }))).status).toBe(401);
    for (const u of ["d_staff", "d_jurado", "d_dev"]) {
      who = `clerk_${u}`;
      expect((await list.GET(req("GET"), ctx())).status, u).toBe(403);
      expect((await one.POST(req("POST"), ctx({ teamId: String(teams.reciclado) }))).status, u).toBe(403);
    }
    for (const u of ["d_org", "d_admin"]) {
      who = `clerk_${u}`;
      const res = await list.GET(req("GET"), ctx());
      expect(res.status, u).toBe(200);
    }
    expect(github).not.toHaveBeenCalled();
  });

  it("time sem repositório aparece com dossiê e declaração vazios", async () => {
    who = "clerk_d_org";
    const data = await (await getDossie()).json();
    const sem = data.teams.find((t: { teamId: number }) => t.teamId === teams.semRepo);
    expect(sem).toMatchObject({ repoUrl: null, collection: null, submitted: false });
    expect(sem.declaration).toEqual({ priorExisted: null, priorWork: null, usedAi: null, aiUsage: null });
  });
});

describe("coleta no envio da entrega", () => {
  it("enviar com repositório lê o GitHub e o organizador vê a linha do tempo com sinais", async () => {
    const r = await asTeam("d_dev");
    expect((await r.PATCH(req("PATCH", project("https://github.com/time/reciclado")), ctx())).status).toBe(200);
    // salvar rascunho não consulta o GitHub
    expect(github).not.toHaveBeenCalled();
    const sent = await r.POST(req("POST"), ctx());
    expect(sent.status).toBe(201);
    await flush();
    expect(github).toHaveBeenCalled();
    for (const call of github.mock.calls) expect(String(call[0])).toMatch(/^http:\/\/127\.0\.0\.1:9\/repos\/time\/reciclado/);

    who = "clerk_d_org";
    const data = await (await getDossie()).json();
    expect(data.window.start).toBeTruthy();
    const t = data.teams.find((x: { teamId: number }) => x.teamId === teams.reciclado);
    expect(t).toMatchObject({ teamName: "Reciclado", submitted: true, repoUrl: "https://github.com/time/reciclado" });
    expect(t.declaration).toEqual({ priorExisted: true, priorWork: "TCC de 2025", usedAi: false, aiUsage: null });
    expect(t.collection).toMatchObject({ repoFullName: "time/reciclado", totalCommits: 4, truncated: false, error: null, stale: false });
    expect(t.collection.timeline).toMatchObject({ before: 3, during: 1, after: 0, counted: 4 });
    expect(t.collection.timeline.signals.map((s: { key: string }) => s.key)).toEqual(["repo_antes", "maioria_antes"]);
    expect(t.collection.commits[0]).toMatchObject({ author: "dev1", message: "commit 1", phase: "durante" });
  });

  it("repositório dentro da janela não sinaliza nada", async () => {
    const r = await asTeam("d_dev2");
    await r.PATCH(req("PATCH", { ...project("https://github.com/time/limpo"), priorExisted: false, priorWork: null }), ctx());
    expect((await r.POST(req("POST"), ctx())).status).toBe(201);
    await flush();
    who = "clerk_d_org";
    const t = (await (await getDossie()).json()).teams.find((x: { teamId: number }) => x.teamId === teams.limpo);
    expect(t.collection.timeline).toMatchObject({ before: 0, during: 3, after: 0 });
    expect(t.collection.timeline.signals).toEqual([]);
    expect(t.declaration.priorExisted).toBe(false);
  });

  it("GitHub fora do ar não derruba o envio: o motivo fica no dossiê", async () => {
    githubDown = true;
    const r = await asTeam("d_dev4");
    await r.PATCH(req("PATCH", project("https://github.com/time/inexistente")), ctx());
    expect((await r.POST(req("POST"), ctx())).status).toBe(201);
    await flush();
    who = "clerk_d_org";
    const t = (await (await getDossie()).json()).teams.find((x: { teamId: number }) => x.teamId === teams.gitlab);
    expect(t.collection).toMatchObject({ collectedAt: null, error: { kind: "network" } });
  });

  it("reenviar logo depois não consulta de novo (5 min)", async () => {
    const r = await asTeam("d_dev");
    await r.PATCH(req("PATCH", { tagline: "versão 2" }), ctx());
    github.mockClear();
    expect((await r.POST(req("POST"), ctx())).status).toBe(201);
    await flush();
    expect(github).not.toHaveBeenCalled();
  });

  it("trocar o repositório e reenviar logo depois também não consulta (cooldown por time)", async () => {
    const r = await asTeam("d_dev");
    github.mockClear();
    expect((await r.POST(req("POST", { repoUrl: "https://github.com/time/outro" }), ctx())).status).toBe(201);
    await flush();
    expect((await r.POST(req("POST", { repoUrl: "https://github.com/time/reciclado" }), ctx())).status).toBe(201);
    await flush();
    expect(github).not.toHaveBeenCalled();
    // passados 5 min, o envio seguinte lê o repositório novo
    await age(teams.reciclado);
    expect((await r.POST(req("POST", { repoUrl: "https://github.com/time/outro" }), ctx())).status).toBe(201);
    await flush();
    expect(github.mock.calls.map((c) => String(c[0]))).toContain("http://127.0.0.1:9/repos/time/outro");
    // volta pro repositório original pros testes seguintes
    await age(teams.reciclado);
    await r.POST(req("POST", { repoUrl: "https://github.com/time/reciclado" }), ctx());
    await flush();
  });

  it("GitHub lento não segura a confirmação: a resposta sai antes da leitura", async () => {
    let release!: () => void;
    hang = new Promise((res) => (release = res));
    try {
      await age(teams.limpo);
      const r = await asTeam("d_dev2");
      github.mockClear();
      const res = await r.POST(req("POST"), ctx());
      expect(res.status).toBe(201);
      expect((await res.json()).version).toBeGreaterThan(1);
      await new Promise((ok) => setTimeout(ok, 0));
      expect(github).toHaveBeenCalledTimes(1); // pendurado no 1º request
      release();
      await flush();
      expect(github.mock.calls.length).toBeGreaterThan(1);
    } finally {
      hang = null;
      release();
    }
  });

  it("enviar grava junto o rascunho pendente, mesmo com o autosave no limite", async () => {
    const r = await asTeam("d_dev2");
    for (let i = 0; i < RATE_LIMITS["entry-draft"].limit; i++) {
      rateLimit(`entry-draft:${ids.d_dev2}`, RATE_LIMITS["entry-draft"]);
    }
    expect((await r.PATCH(req("PATCH", { tagline: "não salva" }), ctx())).status).toBe(429);
    const res = await r.POST(req("POST", { tagline: "texto da última hora" }), ctx());
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.entry.fields.tagline).toBe("texto da última hora");
    await flush();
    const snap = await db
      .prepare("SELECT snapshot FROM project_submissions WHERE teamId = ? ORDER BY version DESC LIMIT 1")
      .get<{ snapshot: string }>(teams.limpo);
    expect(JSON.parse(snap!.snapshot).tagline).toBe("texto da última hora");
  });

  it("corpo inválido no envio → 400 e nada é enviado", async () => {
    const r = await asTeam("d_dev2");
    const bad = new Request("http://t", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{oops" });
    expect((await r.POST(bad, ctx())).status).toBe(400);
    expect((await r.POST(req("POST", [1, 2]), ctx())).status).toBe(400);
  });

  it("limite do autosave fica bem acima do ritmo de digitação (1 save/1,2 s por 1 h)", () => {
    expect(RATE_LIMITS["entry-draft"].limit).toBeGreaterThanOrEqual(3000);
  });

  it("declaração inválida → 400", async () => {
    const r = await asTeam("d_dev");
    expect((await r.PATCH(req("PATCH", { usedAi: "talvez" }), ctx())).status).toBe(400);
  });
});

describe("botão atualizar", () => {
  it("cooldown de 1 min por time → 429; depois lê de novo e grava quem pediu", async () => {
    const one = await import("@/app/api/admin/hackathons/[id]/dossie/[teamId]/route");
    who = "clerk_d_org";
    const cedo = await one.POST(req("POST"), ctx({ teamId: String(teams.reciclado) }));
    expect(cedo.status).toBe(429);
    expect((await cedo.json()).error).toMatch(/Tente de novo em \d+s/);
    await age(teams.reciclado);
    const ok = await one.POST(req("POST"), ctx({ teamId: String(teams.reciclado) }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ status: "ok", commits: 4 });
    const row = await db
      .prepare("SELECT collectedBy FROM project_dossiers WHERE teamId = ?")
      .get<{ collectedBy: number }>(teams.reciclado);
    expect(row!.collectedBy).toBe(ids.d_org);
  });

  it("falha do GitHub guarda o motivo e mantém a última leitura boa do mesmo repositório", async () => {
    const one = await import("@/app/api/admin/hackathons/[id]/dossie/[teamId]/route");
    who = "clerk_d_org";
    await age(teams.reciclado);
    githubDown = true;
    const res = await one.POST(req("POST"), ctx({ teamId: String(teams.reciclado) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "error", kind: "network" });
    const t = (await (await getDossie()).json()).teams.find((x: { teamId: number }) => x.teamId === teams.reciclado);
    expect(t.collection.error.kind).toBe("network");
    expect(t.collection.collectedAt).toBeTruthy();
    expect(t.collection.timeline.counted).toBe(4);
  });

  it("repositório privado/inexistente e link fora do GitHub têm mensagem clara", async () => {
    const one = await import("@/app/api/admin/hackathons/[id]/dossie/[teamId]/route");
    await db
      .prepare("INSERT INTO team_projects (teamId, title, repoUrl) VALUES (?, 'Privado', ?)")
      .run(teams.semRepo, "https://github.com/time/privado");
    who = "clerk_d_org";
    const priv = await one.POST(req("POST"), ctx({ teamId: String(teams.semRepo) }));
    expect(await priv.json()).toMatchObject({ status: "error", kind: "not_found", message: expect.stringMatching(/privado/) });
    await db.prepare("UPDATE team_projects SET repoUrl = ? WHERE teamId = ?").run("https://gitlab.com/time/x", teams.semRepo);
    // repositório trocado: a coleta nova não espera o cooldown do link antigo
    const gl = await one.POST(req("POST"), ctx({ teamId: String(teams.semRepo) }));
    expect(await gl.json()).toMatchObject({ status: "error", kind: "invalid" });
  });

  it("time de outra edição → 404; time sem repositório → 409; id ruim → 404", async () => {
    const one = await import("@/app/api/admin/hackathons/[id]/dossie/[teamId]/route");
    who = "clerk_d_org";
    expect((await one.POST(req("POST"), ctx({ teamId: String(teams.outra) }))).status).toBe(404);
    expect((await one.POST(req("POST"), ctx({ teamId: "abc" }))).status).toBe(404);
    const novo = (await createTeam(H, { name: "Sem nada", placement: 0, memberUsernames: [] })).team.id;
    expect((await one.POST(req("POST"), ctx({ teamId: String(novo) }))).status).toBe(409);
  });

  it("limite de 30 por hora por organizador", async () => {
    const one = await import("@/app/api/admin/hackathons/[id]/dossie/[teamId]/route");
    who = "clerk_d_org";
    for (let i = 0; i < RATE_LIMITS["dossie-refresh"].limit; i++) {
      rateLimit(`dossie-refresh:${ids.d_org}`, RATE_LIMITS["dossie-refresh"]);
    }
    const res = await one.POST(req("POST"), ctx({ teamId: String(teams.reciclado) }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });
});

describe("rate limit da entrega", () => {
  it("enviar versão tem limite por membro", async () => {
    for (let i = 0; i < RATE_LIMITS["entry-submit"].limit; i++) {
      rateLimit(`entry-submit:${ids.d_dev}`, RATE_LIMITS["entry-submit"]);
    }
    const r = await asTeam("d_dev");
    expect((await r.POST(req("POST"), ctx())).status).toBe(429);
    // rascunho tem bucket próprio
    expect((await r.PATCH(req("PATCH", { tagline: "segue salvando" }), ctx())).status).toBe(200);
  });
});
