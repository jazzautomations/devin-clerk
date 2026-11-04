import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { createTeam } from "@/lib/archive";
import { buildWeeks, buildWeeksTeam, weekIndex, weeksFromDates } from "@/lib/buildWeeks";
import { getEntry, saveDraft, submitEntry, toDbTime } from "@/lib/entries";
import { getProjectView } from "@/lib/entriesPublic";
import { listProjects } from "@/lib/projects";
import { listNotifications } from "@/lib/notifications";
import { resetRateLimits } from "@/lib/ratelimit";
import { timelinePage } from "@/lib/timeline";

// Projeto vivo (spec 046, onda 3, migration 044): diário do projeto (post com
// teamId), seguir projeto com 1 aviso por dia, semanas construindo
// (cumulativo, nunca zera), selo "continuou" e continuação entre edições.
// Tudo pelo mesmo PostCard/hydratePosts da conversa no post (034).

let who: string | null = null;
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: who })),
  currentUser: vi.fn(async () => null),
  clerkClient: async () => ({ users: { deleteUser: vi.fn(async () => ({})) } }),
}));

const H = "hack-inova-alphaville-2026";
const ANTERIOR = "vivo-anterior-2025";
const ctx = (teamId: number) => ({ params: Promise.resolve({ teamId: String(teamId) }) });
const req = (method: string, body?: unknown) =>
  new Request("http://t", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const ids: Record<string, number> = {};
let teamId = 0;
let anteriorTeamId = 0;

async function member(u: string) {
  await db
    .prepare("INSERT OR IGNORE INTO members (clerkId, username, email) VALUES (?, ?, ?)")
    .run(`clerk_${u}`, u, `${u}@t.dev`);
  ids[u] = (await db.prepare("SELECT id FROM members WHERE username = ?").get<{ id: number }>(u))!.id;
  await db
    .prepare("INSERT OR IGNORE INTO registrations (memberId, hackathonId, status) VALUES (?, ?, 'approved')")
    .run(ids[u], H);
}

const updates = () => import("@/app/api/projects/[teamId]/updates/route");
const follow = () => import("@/app/api/projects/[teamId]/follow/route");

beforeAll(async () => {
  for (const u of ["pv_ana", "pv_bia", "pv_fora", "pv_segue"]) await member(u);
  // prazo aberto na edição do teste: o rascunho e o envio precisam passar
  await db
    .prepare(
      "UPDATE hackathons SET submissionDeadline = ?, submissionGraceMinutes = 0, submissionOpensAt = NULL, entriesShowContent = 1 WHERE id = ?",
    )
    .run(toDbTime(new Date(Date.now() + 3_600_000)), H);
  teamId = (await createTeam(H, { name: "Time Vivo", placement: 0, memberUsernames: ["pv_ana", "pv_bia"] })).team.id;
  await db
    .prepare(
      "INSERT OR IGNORE INTO team_projects (teamId, title, tagline, description, priorWork, technologies) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(teamId, "Feira Viva", "a feira do bairro no celular", "mostra as barracas abertas agora", "nada", '["Next.js"]');
  // edição anterior, com projeto da pv_ana: é a opção de continuação
  await db
    .prepare(
      `INSERT INTO hackathons (id, name, organizer, startsAt, endsAt, format, registrationUrl, tags, active, source)
       VALUES (?, 'Vivo Anterior', 'Hack Inova', '2025-05-01', '2025-05-02', 'presencial', 'https://t.dev', '[]', 1, 'seed')
       ON CONFLICT (id) DO NOTHING`,
    )
    .run(ANTERIOR);
  anteriorTeamId = (await createTeam(ANTERIOR, { name: "Time Antigo", placement: 0, memberUsernames: ["pv_ana"] })).team.id;
  await db
    .prepare("INSERT INTO team_projects (teamId, title, priorWork, technologies) VALUES (?, 'Feira Antiga', 'nada', '[]')")
    .run(anteriorTeamId);
});

beforeEach(() => resetRateLimits());

describe("diário do projeto — POST /api/projects/[teamId]/updates", () => {
  it("401 deslogado", async () => {
    who = null;
    const r = await updates();
    const res = await r.POST(req("POST", { body: "oi" }), ctx(teamId));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("404 time inexistente", async () => {
    who = "clerk_pv_ana";
    const r = await updates();
    expect((await r.POST(req("POST", { body: "oi" }), ctx(999_999))).status).toBe(404);
    expect((await r.GET(req("GET"), ctx(999_999))).status).toBe(404);
  });

  it("quem não é do time leva 403", async () => {
    who = "clerk_pv_fora";
    const r = await updates();
    const res = await r.POST(req("POST", { body: "quero aparecer aqui" }), ctx(teamId));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/time/);
  });

  it("texto vazio, texto longo e link inválido dão 400", async () => {
    who = "clerk_pv_ana";
    const r = await updates();
    for (const body of [{ body: "   " }, { body: 42 }, {}, { body: "x".repeat(1001) }, { body: "ok", link: "javascript:alert(1)" }]) {
      const res = await r.POST(req("POST", body), ctx(teamId));
      expect(res.status, JSON.stringify(body).slice(0, 40)).toBe(400);
    }
    // 1000 é o teto do diário
    expect((await r.POST(req("POST", { body: "y".repeat(1000) }), ctx(teamId))).status).toBe(201);
  });

  it("integrante posta: o post é do time, aparece no GET e na página do projeto", async () => {
    who = "clerk_pv_bia";
    const r = await updates();
    const res = await r.POST(req("POST", { body: "primeira versão no ar", link: "https://demo.dev" }), ctx(teamId));
    expect(res.status).toBe(201);
    const { post } = await res.json();
    expect(post.body).toBe("primeira versão no ar");
    expect(post.memberId).toBe(ids.pv_bia);
    const row = await db.prepare("SELECT teamId FROM posts WHERE id = ?").get<{ teamId: number }>(post.id);
    expect(Number(row!.teamId)).toBe(teamId);

    // GET é público (a página do projeto é pública)
    who = null;
    const list = await (await updates()).GET(req("GET"), ctx(teamId));
    expect(list.status).toBe(200);
    const body = await list.json();
    expect(body.posts.map((p: { body: string }) => p.body)).toContain("primeira versão no ar");
    expect(body.next).toBeNull();

    const view = await getProjectView(teamId, null);
    expect(view?.teamId).toBe(teamId);
  });

  it("paginação por cursor: 12 atualizações viram 10 + 2", async () => {
    // 12 posts direto no banco: o limite do POST é 10/dia por pessoa
    for (let i = 1; i <= 12; i++) {
      await db
        .prepare("INSERT INTO posts (memberId, body, teamId, createdAt) VALUES (?, ?, ?, ?)")
        .run(ids.pv_ana, `atualização ${i}`, teamId, toDbTime(new Date(Date.now() - i * 60_000)));
    }
    const r = await updates();
    const first = await (await r.GET(req("GET"), ctx(teamId))).json();
    expect(first.posts).toHaveLength(10);
    expect(first.next).toBeTypeOf("number");
    const rest = await (await r.GET(new Request(`http://t?antes=${first.next}`), ctx(teamId))).json();
    expect(rest.posts.length).toBeGreaterThan(0);
    expect(rest.posts[0].id).toBeLessThan(first.next);
    // a página seguinte não repete o que já veio
    const seen = new Set(first.posts.map((p: { id: number }) => p.id));
    expect(rest.posts.every((p: { id: number }) => !seen.has(p.id))).toBe(true);
  });
});

describe("seguir projeto — POST/DELETE /api/projects/[teamId]/follow", () => {
  it("401 deslogado e 404 projeto inexistente", async () => {
    who = null;
    expect((await (await follow()).POST(req("POST"), ctx(teamId))).status).toBe(401);
    who = "clerk_pv_segue";
    expect((await (await follow()).POST(req("POST"), ctx(999_999))).status).toBe(404);
  });

  it("segue, deixa de seguir e é idempotente", async () => {
    who = "clerk_pv_segue";
    const r = await follow();
    expect(await (await r.POST(req("POST"), ctx(teamId))).json()).toEqual({ following: true });
    expect(await (await r.POST(req("POST"), ctx(teamId))).json()).toEqual({ following: true });
    const rows = await db
      .prepare("SELECT COUNT(*)::int AS n FROM project_follows WHERE teamId = ? AND memberId = ?")
      .get<{ n: number }>(teamId, ids.pv_segue);
    expect(rows!.n).toBe(1);
    expect(await (await r.DELETE(req("DELETE"), ctx(teamId))).json()).toEqual({ following: false });
    expect(await (await r.DELETE(req("DELETE"), ctx(teamId))).json()).toEqual({ following: false });
  });
});

describe("aviso de atualização", () => {
  it("seguidor recebe 1 notificação por dia mesmo com 3 atualizações", async () => {
    who = "clerk_pv_segue";
    await (await follow()).POST(req("POST"), ctx(teamId));
    who = "clerk_pv_ana";
    const r = await updates();
    for (const body of ["um", "dois", "três"]) {
      expect((await r.POST(req("POST", { body }), ctx(teamId))).status).toBe(201);
    }
    const got = (await listNotifications(ids.pv_segue)).filter((n) => n.type === "project_update");
    expect(got).toHaveLength(1);
    expect(got[0].href).toBe(`/p/${teamId}`);
    expect(got[0].actorId).toBe(ids.pv_ana);
    // quem postou não é avisado de si mesmo
    expect((await listNotifications(ids.pv_ana)).filter((n) => n.type === "project_update")).toHaveLength(0);
  });

  it("a atualização de projeto seguido entra na aba seguindo da timeline", async () => {
    who = "clerk_pv_segue";
    await (await follow()).POST(req("POST"), ctx(teamId));
    who = "clerk_pv_bia";
    await (await updates()).POST(req("POST", { body: "commit novo no repositório" }), ctx(teamId));
    const page = await timelinePage(ids.pv_segue, "seguindo");
    expect(page.posts.map((p) => p.body)).toContain("commit novo no repositório");
    // quem não segue e não é do time não vê na aba seguindo
    const fora = await timelinePage(ids.pv_fora, "seguindo");
    expect(fora.posts.map((p) => p.body)).not.toContain("commit novo no repositório");
  });
});

describe("migration 044 — afterNotes vira o primeiro post do diário", () => {
  it("converte o texto antigo uma vez só e não duplica", async () => {
    const t = (await createTeam(H, { name: "Time Depois", placement: 0, memberUsernames: ["pv_bia"] })).team.id;
    await db
      .prepare(
        `INSERT INTO team_projects (teamId, title, priorWork, technologies, afterNotes, lastSavedAt)
         VALUES (?, 'Projeto com notas', 'nada', '[]', ?, ?)`,
      )
      .run(t, "virou piloto com a subprefeitura", "2026-03-01 10:00:00");
    const sql = readFileSync(join(process.cwd(), "migrations/044_projeto_vivo.sql"), "utf8");
    await db.exec(sql);
    await db.exec(sql); // idempotente

    const posts = await db
      .prepare("SELECT body, memberId, createdAt FROM posts WHERE teamId = ?")
      .all<{ body: string; memberId: number; createdAt: string }>(t);
    expect(posts).toHaveLength(1);
    expect(posts[0].body).toBe("virou piloto com a subprefeitura");
    expect(Number(posts[0].memberId)).toBe(ids.pv_bia);
    expect(posts[0].createdAt).toBe("2026-03-01 10:00:00");
    // o campo continua no banco (histórico/export), só sai da vitrine
    const notes = await db.prepare("SELECT afterNotes FROM team_projects WHERE teamId = ?").get<{ afterNotes: string }>(t);
    expect(notes!.afterNotes).toBe("virou piloto com a subprefeitura");
  });
});

describe("semanas construindo (migration 044)", () => {
  it("conta semanas distintas do diário e do dossiê, sem zerar", async () => {
    const t = (await createTeam(H, { name: "Time Semanas", placement: 0, memberUsernames: ["pv_ana"] })).team.id;
    const now = new Date();
    const week = (n: number) => new Date(now.getTime() - n * 7 * 86_400_000);
    for (const w of [4, 2, 1]) {
      await db
        .prepare("INSERT INTO posts (memberId, body, teamId, createdAt) VALUES (?, ?, ?, ?)")
        .run(ids.pv_ana, `semana ${w}`, t, toDbTime(week(w)));
    }
    // commit de uma semana que o diário não cobre (semana 3)
    await db
      .prepare(
        `INSERT INTO project_dossiers (teamId, repoUrl, commits, collectedAt, attemptedAt)
         VALUES (?, 'https://github.com/t/vivo', ?, ?, ?)
         ON CONFLICT (teamId) DO UPDATE SET commits = excluded.commits, collectedAt = excluded.collectedAt`,
      )
      .run(t, JSON.stringify([{ sha: "a", date: toDbTime(week(3)), author: "x", message: "m" }]), toDbTime(now), toDbTime(now));
    const weeks = await buildWeeksTeam(t, now);
    // 4 semanas distintas; a semana 0 (agora) está vazia e é perdoada
    expect(weeks.total).toBe(4);
    expect(weeks.sequencia).toBe(4);
    // o contador da PESSOA (o /u usa na onda 4) conta o diário dela e os
    // commits do time dela
    const daPessoa = await buildWeeks(ids.pv_ana, now);
    expect(daPessoa.total).toBeGreaterThanOrEqual(3);
    expect(daPessoa.sequencia).toBeGreaterThanOrEqual(3);
    // quem não construiu nada no time não herda as semanas dele
    expect((await buildWeeks(ids.pv_fora, now)).total).toBe(0);
    // semana vazia não zera o total: some a semana 1 e o total continua 4
    await db.prepare("DELETE FROM posts WHERE teamId = ? AND body = ?").run(t, "semana 1");
    const depois = await buildWeeksTeam(t, now);
    expect(depois.total).toBe(3);
    expect(depois.sequencia).toBe(3);
  });
});

describe("continuação entre edições (migration 044)", () => {
  it("PATCH marca a continuação e o snapshot leva continuesTeamId", async () => {
    const t = (await createTeam(H, { name: "Time Continua", placement: 0, memberUsernames: ["pv_ana"] })).team.id;
    const entry = await saveDraft(
      t,
      { username: "pv_ana" },
      {
        title: "Feira Viva 2",
        tagline: "a feira agora com mapa",
        description: "mapa das barracas",
        repoUrl: "https://github.com/t/feira",
        priorWork: "a feira viva do ano passado, com as barracas e o horário",
        technologies: ["Next.js"],
        continuesTeamId: anteriorTeamId,
      },
    );
    expect(entry.fields!.continuesTeamId).toBe(anteriorTeamId);
    // continuação é declaração de trabalho anterior
    expect(entry.fields!.priorExisted).toBe(true);
    expect(entry.missing).toEqual([]);

    const sent = await submitEntry(t, { id: ids.pv_ana, username: "pv_ana" });
    expect(sent.version).toBe(1);
    const row = await db
      .prepare("SELECT snapshot FROM project_submissions WHERE teamId = ? ORDER BY version DESC LIMIT 1")
      .get<{ snapshot: string }>(t);
    expect(JSON.parse(row!.snapshot).continuesTeamId).toBe(anteriorTeamId);

    // /p mostra "continua [projeto anterior]"
    const view = await getProjectView(t, null);
    expect(view?.continues).toMatchObject({ teamId: anteriorTeamId, title: "Feira Antiga", hackathonId: ANTERIOR });
  });

  it("projeto de outra pessoa, projeto da mesma edição e ele mesmo dão 400", async () => {
    const t = (await createTeam(H, { name: "Time Errado", placement: 0, memberUsernames: ["pv_bia"] })).team.id;
    await db.prepare("INSERT INTO team_projects (teamId, title, technologies) VALUES (?, 'Errado', '[]')").run(t);
    const alheio = (await createTeam(ANTERIOR, { name: "Time de Outro", placement: 0, memberUsernames: ["pv_fora"] })).team.id;
    await db
      .prepare("INSERT INTO team_projects (teamId, title, technologies) VALUES (?, 'Alheio', '[]')")
      .run(alheio);
    const patch = (body: Record<string, unknown>) => saveDraft(t, { username: "pv_bia" }, body);
    await expect(patch({ continuesTeamId: alheio })).rejects.toMatchObject({ status: 400 });
    await expect(patch({ continuesTeamId: t })).rejects.toMatchObject({ status: 400 });
    await expect(patch({ continuesTeamId: 999_999 })).rejects.toMatchObject({ status: 400 });
    await expect(patch({ continuesTeamId: "x" })).rejects.toMatchObject({ status: 400 });
    // null desliga (projeto novo)
    const ok = await patch({ continuesTeamId: null });
    expect(ok.fields!.continuesTeamId).toBeNull();
  });

  it("continuação sem priorWork dá 400 no envio", async () => {
    const t = (await createTeam(H, { name: "Time Sem Texto", placement: 0, memberUsernames: ["pv_ana"] })).team.id;
    await saveDraft(t, { username: "pv_ana" }, {
      title: "Feira 3",
      tagline: "a feira",
      description: "mapa",
      repoUrl: "https://github.com/t/feira",
      technologies: ["Go"],
      continuesTeamId: anteriorTeamId,
    });
    const entry = await getEntry(t);
    expect(entry!.missing).toContain("o que já existia antes do evento");
    await expect(submitEntry(t, { id: ids.pv_ana, username: "pv_ana" })).rejects.toMatchObject({ status: 400 });
    // com o texto (20+) o envio passa
    await saveDraft(t, { username: "pv_ana" }, { priorWork: "o protótipo da feira do ano passado, só o mapa" });
    expect((await getEntry(t))!.missing).toEqual([]);
    // continuação pede uma frase: acima de 1000 é 400
    await expect(saveDraft(t, { username: "pv_ana" }, { priorWork: "x".repeat(1001) })).rejects.toMatchObject({ status: 400 });
    expect((await submitEntry(t, { id: ids.pv_ana, username: "pv_ana" })).version).toBe(1);
  });
});

describe("apagar o time", () => {
  it("leva as atualizações do diário sem erro de FK", async () => {
    const t = (await createTeam(H, { name: "Time Efêmero", placement: 0, memberUsernames: ["pv_ana"] })).team.id;
    await db.prepare("INSERT INTO team_projects (teamId, title, technologies) VALUES (?, 'Efêmero', '[]')").run(t);
    who = "clerk_pv_ana";
    const created = await (await updates()).POST(req("POST", { body: "some com o time" }), ctx(t));
    expect(created.status).toBe(201);
    const { post } = await created.json();
    // reação e comentário no post: o cascade da 034 deixa o DELETE passar
    await db.prepare("INSERT INTO likes (postId, memberId, kind) VALUES (?, ?, 'curti')").run(post.id, ids.pv_bia);
    await db.prepare("INSERT INTO post_comments (postId, memberId, body) VALUES (?, ?, 'boa')").run(post.id, ids.pv_bia);
    // apagar o time na ordem do app (equipe, projeto, time): posts.teamId está
    // em ON DELETE CASCADE, então o diário sai junto sem travar em FK
    await db.prepare("DELETE FROM team_members WHERE teamId = ?").run(t);
    await db.prepare("DELETE FROM team_projects WHERE teamId = ?").run(t);
    await db.prepare("DELETE FROM teams WHERE id = ?").run(t);
    expect(await db.prepare("SELECT 1 FROM posts WHERE id = ?").get(post.id)).toBeUndefined();
    expect(await db.prepare("SELECT 1 FROM likes WHERE postId = ?").get(post.id)).toBeUndefined();
    expect(await db.prepare("SELECT 1 FROM post_comments WHERE postId = ?").get(post.id)).toBeUndefined();
  });
});

describe("selo continuou", () => {
  it("continuedAt aparece no card e ?continuou=1 filtra", async () => {
    // edição sem prazo de entrega: o projeto entra no índice público direto
    const t = (await createTeam(ANTERIOR, { name: "Time Continuou", placement: 0, memberUsernames: ["pv_bia"] })).team.id;
    await db
      .prepare("INSERT INTO team_projects (teamId, title, repoUrl, technologies) VALUES (?, 'Segue Vivo', 'https://github.com/t/vivo', '[]')")
      .run(t);
    const cards = await listProjects({ hackathonId: ANTERIOR });
    expect(cards.find((c) => c.teamId === t)?.continuedAt).toBeNull();
    await db.prepare("UPDATE team_projects SET continuedAt = ? WHERE teamId = ?").run("2026-04-02 12:00:00", t);
    expect((await listProjects({ hackathonId: ANTERIOR })).find((c) => c.teamId === t)?.continuedAt).toBe("2026-04-02 12:00:00");
    expect((await listProjects({ hackathonId: ANTERIOR, continued: true })).map((c) => c.teamId)).toEqual([t]);
    expect((await listProjects({ continued: true })).every((c) => c.continuedAt !== null)).toBe(true);
  });
});

describe("lib/buildWeeks — contador", () => {
  it("weeksFromDates junta datas da mesma semana e a sequência perdoa 2 vazias no mês", () => {
    const now = new Date("2026-10-28T12:00:00Z");
    const weeks = weeksFromDates([
      "2026-10-27 10:00:00",
      "2026-10-26 09:00:00", // mesma semana
      "2026-10-13 10:00:00",
    ]);
    expect(weeks).toHaveLength(2);
    expect(weeks[0]).toBeLessThan(weeks[1]);
    expect(weekIndex(now)).toBe(weeks[1]);
  });
});
