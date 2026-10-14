import { expect, type APIRequestContext } from "@playwright/test";
import { test } from "./auth";
import { openE2eDb } from "./db";

// Modo palco (spec 033, frente F). Login real é bloqueado pelo captcha,
// então o e2e cobre o lado público e os portões: telão renderiza o estado
// seedado e acompanha o banco via SSE, ranking final com empate, voto e
// controle exigem login, stream responde text/event-stream. O fluxo logado
// (votar, operar) está coberto nos testes de API.

const LIVE = "e2e-palco-live";
const ENDED = "e2e-palco-fim";
const NOQUORUM = "e2e-palco-sem-quorum";
const SHOTS = process.env.SHOTS_DIR ?? "test-results/stage";

const db = openE2eDb();

async function edition(id: string, name: string) {
  await db
    .prepare(
      `INSERT INTO hackathons
         (id, name, organizer, startsAt, format, registrationUrl, tags, active, source)
       VALUES (?, ?, 'Hack Inova E2E', ?, 'presencial', 'https://e2e.dev/palco', '[]', 1, 'e2e')
       ON CONFLICT(id) DO UPDATE SET active = 1, "audienceMinVotes" = DEFAULT`,
    )
    .run(id, name, new Date(Date.now() - 3600_000).toISOString());
  for (const t of ["live_votes", "stage_queue", "stage_sessions"]) {
    await db.prepare(`DELETE FROM ${t} WHERE hackathonId = ?`).run(id);
  }
}

async function team(hackathonId: string, name: string, title: string): Promise<number> {
  const existing = await db
    .prepare("SELECT id FROM teams WHERE hackathonId = ? AND name = ?")
    .get<{ id: number }>(hackathonId, name);
  const id =
    existing?.id ??
    Number((await db.prepare("INSERT INTO teams (hackathonId, name, placement) VALUES (?, ?, 0)").run(hackathonId, name)).lastInsertRowid);
  await db
    .prepare("INSERT OR REPLACE INTO team_projects (teamId, title, description) VALUES (?, ?, 'pitch de e2e')")
    .run(id, title);
  return id;
}

async function voter(n: number): Promise<number> {
  await db
    .prepare("INSERT OR IGNORE INTO members (clerkId, username, email) VALUES (?, ?, ?)")
    .run(`e2e_palco_${n}`, `palco_${n}`, `palco_${n}@e2e.dev`);
  return (await db.prepare("SELECT id FROM members WHERE clerkId = ?").get<{ id: number }>(`e2e_palco_${n}`))!.id;
}

async function votes(hackathonId: string, teamId: number, scores: number[], offset = 0) {
  for (const [i, s] of scores.entries()) {
    await db
      .prepare("INSERT INTO live_votes (hackathonId, teamId, memberId, score) VALUES (?, ?, ?, ?)")
      .run(hackathonId, teamId, await voter(offset + i), s);
  }
}

let liveA = 0;
let liveB = 0;
let endedA = 0;

async function seed(request: APIRequestContext) {
  await request.get("/api/health"); // força init/migrações no server do e2e
  await edition(LIVE, "E2E Final Ao Vivo");
  liveA = await team(LIVE, "Time Alfa", "Projeto Palco Alfa");
  liveB = await team(LIVE, "Time Beta", "Projeto Palco Beta");
  const c = await team(LIVE, "Time Gama", "Projeto Palco Gama");
  for (const [i, id] of [liveA, liveB, c].entries()) {
    await db.prepare("INSERT INTO stage_queue (hackathonId, teamId, position) VALUES (?, ?, ?)").run(LIVE, id, i + 1);
  }
  const startedAt = new Date(Date.now() - 65_000).toISOString().replace("T", " ").replace("Z", "");
  await db
    .prepare(
      `INSERT INTO stage_sessions (hackathonId, status, currentTeamId, pitchSeconds, pitchStartedAt, votingOpen)
       VALUES (?, 'live', ?, 180, ?, 1)`,
    )
    .run(LIVE, liveA, startedAt);
  await votes(LIVE, liveA, [5, 4, 5, 3, 5, 4, 2]);

  await edition(ENDED, "E2E Final Encerrada");
  endedA = await team(ENDED, "Time Norte", "Radar de Enchentes");
  const eb = await team(ENDED, "Time Sul", "Feira Sem Fila");
  const ec = await team(ENDED, "Time Leste", "Bilhete Único Escolar");
  for (const [i, id] of [endedA, eb, ec].entries()) {
    await db.prepare("INSERT INTO stage_queue (hackathonId, teamId, position) VALUES (?, ?, ?)").run(ENDED, id, i + 1);
  }
  await db.prepare("INSERT INTO stage_sessions (hackathonId, status) VALUES (?, 'ended')").run(ENDED);
  await votes(ENDED, endedA, [5, 4, 5, 4]); // 4.5
  await votes(ENDED, eb, [5, 4], 10); // 4.5 → empate com Norte
  await votes(ENDED, ec, [3, 4, 3, 3], 20); // 3.25 — total 10 = quórum default exato

  // frente N #5 — final encerrada com 3 votos e mínimo 10: sem quórum
  await edition(NOQUORUM, "E2E Final Sem Quórum");
  const qa = await team(NOQUORUM, "Time Poucos", "Projeto Pouco Votado");
  await db.prepare("INSERT INTO stage_queue (hackathonId, teamId, position) VALUES (?, ?, 1)").run(NOQUORUM, qa);
  await db.prepare("INSERT INTO stage_sessions (hackathonId, status) VALUES (?, 'ended')").run(NOQUORUM);
  await votes(NOQUORUM, qa, [5, 5, 4], 40);
}

const noHorizontalScroll = async (page: import("@playwright/test").Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test.describe("modo palco — final ao vivo", () => {
  test.beforeEach(async ({ request }) => {
    await seed(request);
  });

  test("telão público mostra o pitch, cronômetro, QR e placar (1920×1080)", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(`/h/${LIVE}/telao`);
    const screen = page.getByTestId("stage-screen");
    await expect(screen).toHaveAttribute("data-status", "live");
    await expect(page.getByTestId("stage-current")).toContainText("Projeto Palco Alfa");
    await expect(page.getByTestId("stage-current")).toContainText("time Time Alfa");
    await expect(page.getByTestId("stage-position")).toHaveText("PITCH 1/3");
    await expect(page.getByTestId("stage-voting").first()).toHaveText("VOTAÇÃO ABERTA");
    await expect(page.getByTestId("stage-tally")).toContainText("7 votos");
    await expect(page.locator('[role="img"] svg')).toHaveCount(1); // QR
    const digits = page.getByTestId("stage-timer").locator("span").first();
    await expect(digits).toHaveText(/^0[01]:\d\d$/); // ~1:55 restando
    await expect(page.getByText("A SEGUIR ▸")).toBeVisible();
    expect(await noHorizontalScroll(page)).toBe(true);
    await page.waitForTimeout(800); // barras do placar terminam a transição
    await page.screenshot({ path: `${SHOTS}/telao-ao-vivo-1920.png` });
  });

  test("telão acompanha o banco em tempo real (SSE): troca de pitch e votação", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(`/h/${LIVE}/telao`);
    await expect(page.getByTestId("stage-current")).toContainText("Projeto Palco Alfa");
    await expect(page.getByText("● AO VIVO")).toBeVisible({ timeout: 10_000 });
    await db
      .prepare("UPDATE stage_sessions SET currentTeamId = ?, votingOpen = 0, pitchStartedAt = NULL WHERE hackathonId = ?")
      .run(liveB, LIVE);
    await expect(page.getByTestId("stage-current")).toContainText("Projeto Palco Beta", { timeout: 8_000 });
    await expect(page.getByTestId("stage-voting").first()).toHaveText("VOTAÇÃO FECHADA");
    await expect(page.getByTestId("stage-position")).toHaveText("PITCH 2/3");
  });

  test("final encerrada: ranking da escolha do público com empate visível", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(`/h/${ENDED}/telao`);
    await expect(page.getByTestId("stage-screen")).toHaveAttribute("data-status", "ended");
    const rows = page.getByTestId("stage-ranking").locator("li");
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText("1º");
    await expect(rows.nth(1)).toContainText("1º");
    await expect(rows.nth(0)).toContainText("EMPATE");
    await expect(rows.nth(2)).toContainText("3º");
    await expect(rows.nth(2)).toContainText("Bilhete Único Escolar");
    await page.waitForTimeout(3500); // revelação animada termina
    await page.screenshot({ path: `${SHOTS}/telao-resultado-1920.png` });
  });

  test("final sem quórum: telão diz 'votação sem quórum' e não revela ranking", async ({ page, request }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(`/h/${NOQUORUM}/telao`);
    await expect(page.getByTestId("stage-screen")).toHaveAttribute("data-status", "ended");
    await expect(page.getByTestId("stage-no-quorum")).toContainText("VOTAÇÃO SEM QUÓRUM");
    await expect(page.getByTestId("stage-no-quorum")).toContainText("3 de 10");
    await expect(page.getByTestId("stage-ranking")).toHaveCount(0);
    const snap = await (await request.get(`/api/hackathons/${NOQUORUM}/stage`)).json();
    expect(snap).toMatchObject({ status: "ended", ranking: null, quorum: { min: 10, total: 3, met: false } });
    await page.screenshot({ path: `${SHOTS}/telao-sem-quorum-1920.png` });
  });

  test("telão em 390px não estoura horizontal", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/h/${LIVE}/telao`);
    await expect(page.getByTestId("stage-current")).toBeVisible();
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test("/h/[id]/votar e o painel do palco exigem login", async ({ page }) => {
    await page.goto(`/h/${LIVE}/votar`);
    await expect(page).toHaveURL(/sign-in|sign-up|clerk/i, { timeout: 15_000 });
    await page.goto(`/admin/h/${LIVE}/palco`);
    await expect(page).toHaveURL(/sign-in|sign-up|clerk/i, { timeout: 15_000 });
  });

  test("APIs de controle e voto anon → 401 JSON; snapshot público 200", async ({ request }) => {
    const calls = [
      request.get(`/api/admin/hackathons/${LIVE}/stage`),
      request.post(`/api/admin/hackathons/${LIVE}/stage`, { data: { action: "next" } }),
      request.get(`/api/hackathons/${LIVE}/stage/vote`),
      request.post(`/api/hackathons/${LIVE}/stage/vote`, { data: { teamId: liveA, score: 5 } }),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status()).toBe(401);
      expect(res.headers()["content-type"]).toContain("application/json");
    }
    const snap = await request.get(`/api/hackathons/${LIVE}/stage`);
    expect(snap.status()).toBe(200);
    expect(await snap.json()).toMatchObject({ status: "live", current: { teamId: liveA }, votingOpen: true });
  });

  test("stream SSE responde text/event-stream sem buffer e manda o snapshot", async ({ baseURL }) => {
    const ac = new AbortController();
    const res = await fetch(`${baseURL}/api/hackathons/${LIVE}/stage/stream`, {
      signal: ac.signal,
      headers: { "Accept-Encoding": "gzip, br" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("cache-control")).toContain("no-cache");
    expect(res.headers.get("x-accel-buffering")).toBe("no");
    expect(res.headers.get("content-encoding")).toBeNull(); // compressão seguraria os eventos
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = "";
    const deadline = Date.now() + 5_000;
    while (!/event: stage\ndata: .*\n\n/.test(buf) && Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
    }
    ac.abort();
    const data = JSON.parse(buf.split("event: stage\ndata: ")[1].split("\n")[0]);
    expect(data).toMatchObject({ hackathonId: LIVE, status: "live", current: { title: "Projeto Palco Alfa" } });
  });

  test("página da edição chama pro voto; ficha do projeto mostra a escolha do público", async ({ memberPage: page }) => {
    await page.goto(`/h/${LIVE}`, { waitUntil: "domcontentloaded" });
    const cta = page.getByTestId("stage-cta");
    await expect(cta).toContainText("FINAL AO VIVO");
    await expect(cta.getByRole("link", { name: "votar agora →" })).toHaveAttribute("href", `/h/${LIVE}/votar`);

    await page.goto(`/p/${endedA}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("audience-result")).toContainText("1º de 3 (empate)");
    await expect(page.getByTestId("audience-result")).toContainText("média 4,5/5");
  });
});
