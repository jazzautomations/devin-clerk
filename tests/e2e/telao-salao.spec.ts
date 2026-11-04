import { expect } from "@playwright/test";
import { test } from "./auth";
import { openE2eDb } from "./db";

// Salão do telão (spec 046, onda 4 — telao-e-bicho-do-time). Login real é
// bloqueado pelo captcha, então o e2e cobre o lado público: o telão na tela
// 'salao' com os bichos de quem consentiu, os contadores do rodapé, a
// bandeira do time entregue e o bicho do time na página do projeto (390px).

const ED = "e2e-telao-salao";
const db = openE2eDb();

async function edition() {
  await db
    .prepare(
      `INSERT INTO hackathons (id, name, organizer, startsAt, format, registrationUrl, tags, active, source, entriesShowContent)
       VALUES (?, 'E2E Salão', 'Hack Inova E2E', ?, 'presencial', 'https://e2e.dev/salao', '[]', 1, 'painel', 1)
       ON CONFLICT(id) DO UPDATE SET active = 1, entriesShowContent = 1`,
    )
    .run(ED, new Date(Date.now() - 3600_000).toISOString());
  for (const t of ["stage_queue", "stage_sessions"]) await db.prepare(`DELETE FROM ${t} WHERE hackathonId = ?`).run(ED);
  await db
    .prepare("DELETE FROM team_members WHERE teamId IN (SELECT id FROM teams WHERE hackathonId = ?)")
    .run(ED);
  await db.prepare("DELETE FROM checkins WHERE registrationId IN (SELECT id FROM registrations WHERE hackathonId = ?)").run(ED);
  await db.prepare("DELETE FROM registrations WHERE hackathonId = ?").run(ED);
  await db.prepare("DELETE FROM project_submissions WHERE teamId IN (SELECT id FROM teams WHERE hackathonId = ?)").run(ED);
  await db.prepare("DELETE FROM team_projects WHERE teamId IN (SELECT id FROM teams WHERE hackathonId = ?)").run(ED);
  await db.prepare("DELETE FROM teams WHERE hackathonId = ?").run(ED);
  await db
    .prepare("INSERT INTO stage_sessions (hackathonId, status, screen) VALUES (?, 'idle', 'salao')")
    .run(ED);
}

async function member(username: string, name: string): Promise<number> {
  await db
    .prepare("INSERT INTO members (clerkId, username, email, name) VALUES (?, ?, ?, ?) ON CONFLICT(clerkId) DO NOTHING")
    .run(`e2e_salao_${username}`, username, `${username}@e2e.dev`, name);
  return (await db.prepare("SELECT id FROM members WHERE username = ?").get<{ id: number }>(username))!.id;
}

async function checkIn(memberId: number, listing: boolean) {
  await db
    .prepare("INSERT INTO registrations (memberId, hackathonId, status, publicListing) VALUES (?, ?, 'approved', ?)")
    .run(memberId, ED, listing ? 1 : 0);
  const r = await db
    .prepare("SELECT id FROM registrations WHERE memberId = ? AND hackathonId = ?")
    .get<{ id: number }>(memberId, ED);
  await db.prepare("INSERT INTO checkins (registrationId) VALUES (?)").run(r!.id);
}

async function team(name: string, title: string, usernames: string[], entregou: boolean): Promise<number> {
  const id = Number(
    (await db.prepare("INSERT INTO teams (hackathonId, name, placement) VALUES (?, ?, 0)").run(ED, name)).lastInsertRowid,
  );
  await db.prepare("INSERT INTO team_projects (teamId, title) VALUES (?, ?)").run(id, title);
  for (const u of usernames) await db.prepare("INSERT INTO team_members (teamId, username) VALUES (?, ?)").run(id, u);
  if (entregou) await db.prepare("INSERT INTO project_submissions (teamId, version, snapshot) VALUES (?, 1, '{}')").run(id);
  return id;
}

let alfa = 0;

async function seed(request: import("@playwright/test").APIRequestContext) {
  await request.get("/api/health"); // força init/migrações no server do e2e
  await edition();
  const ana = await member("e2e_salao_ana", "Ana Souza");
  const bia = await member("e2e_salao_bia", "Bia Lima");
  const caio = await member("e2e_salao_caio", "Caio Reis");
  const duda = await member("e2e_salao_duda", "Duda Alves");
  await checkIn(ana, true);
  await checkIn(bia, true);
  await checkIn(caio, false); // não consentiu: conta e não aparece
  await checkIn(duda, true);
  alfa = await team("Time Alfa", "Projeto Salão Alfa", ["e2e_salao_ana", "e2e_salao_bia"], true);
  await team("Time Beta", "Projeto Salão Beta", ["e2e_salao_duda"], false);
  await db.prepare("INSERT INTO team_members (teamId, username) VALUES (?, ?)").run(alfa, "e2e_salao_caio");
}

test.describe("salão no telão", () => {
  test.beforeEach(async ({ request }) => {
    await seed(request);
  });

  test("telão na tela salão mostra os bichos de quem consentiu e os contadores", async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(`/h/${ED}/telao`);
    const screen = page.getByTestId("stage-screen");
    await expect(screen).toHaveAttribute("data-screen", "salao");
    await expect(screen).toContainText("SALÃO");

    const salao = page.getByTestId("telao-salao");
    await expect(salao).toBeVisible();
    await expect(salao).toHaveAttribute("data-bichos", "3"); // 4 com check-in, 3 consentidos
    await expect(page.getByTestId("salao-contadores")).toContainText("4 presentes");
    await expect(page.getByTestId("salao-contadores")).toContainText("2 times");
    await expect(page.getByTestId("salao-contadores")).toContainText("1 entrega");
    // com WebGL a cena 3D monta; sem WebGL cai na grade de <img> — as duas
    // mostram o salão, nenhuma fica em branco
    await expect
      .poll(async () => (await salao.getAttribute("data-modo")) ?? "", { timeout: 15_000 })
      .toMatch(/^(3d|grade)$/);
    const modo = await salao.getAttribute("data-modo");
    if (modo === "grade") await expect(page.getByTestId("telao-salao-grade").locator("img")).toHaveCount(3);
    else await expect(page.getByTestId("telao-salao-3d")).toBeVisible();
  });

  test("a tela troca pelo estado do evento: palco mostra a final, não o salão", async ({ page }) => {
    await db.prepare("UPDATE stage_sessions SET screen = 'palco' WHERE hackathonId = ?").run(ED);
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(`/h/${ED}/telao`);
    await expect(page.getByTestId("stage-screen")).toHaveAttribute("data-screen", "palco");
    await expect(page.getByTestId("telao-salao")).toHaveCount(0);
    await expect(page.getByTestId("stage-idle")).toBeVisible();
  });

  test("bicho do time na página do projeto, 390px sem scroll horizontal", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/p/${alfa}`);
    await expect(page.getByTestId("project-page")).toBeVisible();
    const bicho = page.getByTestId("project-team-bicho");
    await expect(bicho).toBeVisible();
    await expect(bicho).toContainText("montado com uma parte do bicho de cada integrante");
    // com WebGL o viewer troca o <img> do SVG pelo canvas; sem WebGL fica a
    // imagem. Um dos dois sempre está lá.
    await expect(bicho.locator("img, canvas")).toHaveCount(1);
    const { sw, iw } = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      iw: window.innerWidth,
    }));
    expect(sw, "scroll horizontal").toBeLessThanOrEqual(iw);
  });

  test("o SVG do bicho do time responde público e é imagem", async ({ request }) => {
    const res = await request.get(`/api/mascote/time/${alfa}`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/svg+xml");
    expect(await res.text()).toContain("<svg");
  });
});
