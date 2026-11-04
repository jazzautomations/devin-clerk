import { expect, type Page } from "@playwright/test";
import { E2E_MEMBER_EMAIL, memberRequest, test } from "./auth";
import { openE2eDb } from "./db";

// Projeto vivo (spec 046, onda 3, migration 044). O time posta no diário do
// projeto pela própria página, quem quiser segue o projeto, a página conta as
// semanas construindo (cumulativo), mostra o selo "continuou" e o projeto
// anterior quando é continuação. Tudo a 390px sem scroll de lado.
//
// O cron do selo é testado em unit (tests/unit/continuity.test.ts com o
// dossiê mockado); aqui o continuedAt é semeado no banco.

const ED = "e2e-vivo";
const ANTERIOR = "e2e-vivo-anterior";
const H = 3_600_000;
const DAY = 24 * H;
const SHOTS = process.env.E2E_SHOTS_DIR;
const ids: Record<string, number> = {};
const dbTime = (t: number) => new Date(t).toISOString().slice(0, 19).replace("T", " ");

async function noHorizontalScroll(page: Page) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(sw, "scroll horizontal").toBeLessThanOrEqual(iw);
}

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

test.describe.configure({ mode: "serial" });

/** o banco do e2e é um só: some com o que esta spec criou (diário, seguir, times) */
async function cleanup() {
  const db = openE2eDb();
  const times = "SELECT id FROM teams WHERE hackathonId IN (?, ?)";
  await db.prepare(`DELETE FROM posts WHERE teamId IN (${times})`).run(ED, ANTERIOR);
  await db.prepare(`DELETE FROM project_follows WHERE teamId IN (${times})`).run(ED, ANTERIOR);
  await db.prepare(`DELETE FROM project_dossiers WHERE teamId IN (${times})`).run(ED, ANTERIOR);
  await db.prepare(`DELETE FROM project_tech WHERE teamId IN (${times})`).run(ED, ANTERIOR);
  await db.prepare(`DELETE FROM team_projects WHERE teamId IN (${times})`).run(ED, ANTERIOR);
  await db.prepare(`DELETE FROM team_members WHERE teamId IN (${times})`).run(ED, ANTERIOR);
  await db.prepare(`DELETE FROM teams WHERE hackathonId IN (?, ?)`).run(ED, ANTERIOR);
  await db.prepare("DELETE FROM registrations WHERE hackathonId IN (?, ?)").run(ED, ANTERIOR);
  await db.prepare("DELETE FROM members WHERE username = 'vivo_par'").run();
}

test.describe("projeto vivo", () => {
  test.beforeAll(async ({ request }) => {
    await request.get("/api/health");
    const db = openE2eDb();
    // edição encerrada há 60 dias (a página fica no modo legado: conteúdo aberto)
    await db
      .prepare(
        `INSERT INTO hackathons (id, name, organizer, startsAt, endsAt, format, registrationUrl, tags, active, source)
         VALUES (?, 'E2E Projeto Vivo', 'Hack Inova E2E', ?, ?, 'presencial', '/h/e2e-vivo', '[]', 1, 'painel')
         ON CONFLICT (id) DO UPDATE SET startsAt = excluded.startsAt, endsAt = excluded.endsAt, active = 1`,
      )
      .run(ED, dbTime(Date.now() - 62 * DAY), dbTime(Date.now() - 60 * DAY));
    await db
      .prepare(
        `INSERT INTO hackathons (id, name, organizer, startsAt, endsAt, format, registrationUrl, tags, active, source)
         VALUES (?, 'E2E Projeto Vivo 2024', 'Hack Inova E2E', '2024-05-01', '2024-05-02', 'presencial', '/h/e2e-vivo-anterior', '[]', 1, 'painel')
         ON CONFLICT (id) DO UPDATE SET active = 1`,
      )
      .run(ANTERIOR);
    for (const sql of [
      "DELETE FROM announcements WHERE hackathonId IN (?, ?)",
      "DELETE FROM posts WHERE teamId IN (SELECT id FROM teams WHERE hackathonId IN (?, ?))",
      "DELETE FROM project_dossiers WHERE teamId IN (SELECT id FROM teams WHERE hackathonId IN (?, ?))",
      "DELETE FROM project_tech WHERE teamId IN (SELECT id FROM teams WHERE hackathonId IN (?, ?))",
      "DELETE FROM team_projects WHERE teamId IN (SELECT id FROM teams WHERE hackathonId IN (?, ?))",
      "DELETE FROM team_members WHERE teamId IN (SELECT id FROM teams WHERE hackathonId IN (?, ?))",
      "DELETE FROM teams WHERE hackathonId IN (?, ?)",
      "DELETE FROM registrations WHERE hackathonId IN (?, ?)",
    ]) {
      await db.prepare(sql).run(ED, ANTERIOR);
    }
    const me = await db
      .prepare("SELECT id, username FROM members WHERE email = ?")
      .get<{ id: number; username: string }>(E2E_MEMBER_EMAIL);
    if (!me) throw new Error("membro de teste não existe no banco do e2e");
    await db
      .prepare(
        `INSERT INTO members (clerkId, username, email, name) VALUES ('clerk_vivo_par', 'vivo_par', 'vivo_par@e2e.dev', 'Par Vivo')
         ON CONFLICT DO NOTHING`,
      )
      .run();
    const par = (await db.prepare("SELECT id FROM members WHERE username = 'vivo_par'").get<{ id: number }>())!;
    for (const id of [me.id, par.id]) {
      await db.prepare("INSERT INTO registrations (memberId, hackathonId, status) VALUES (?, ?, 'approved')").run(id, ED);
    }

    // time anterior, da mesma pessoa: é a opção de continuação
    const anterior = (
      await db
        .prepare("INSERT INTO teams (hackathonId, name, placement) VALUES (?, 'Time Antigo E2E', 0) RETURNING id")
        .get<{ id: number }>(ANTERIOR)
    )!;
    ids.anterior = anterior.id;
    await db.prepare("INSERT INTO team_members (teamId, username) VALUES (?, ?)").run(ids.anterior, me.username);
    await db
      .prepare("INSERT INTO team_projects (teamId, title, priorWork, technologies) VALUES (?, 'Feira Antiga E2E', 'nada antes', '[]')")
      .run(ids.anterior);

    // time do membro de teste: ele posta no diário
    const meu = (
      await db
        .prepare("INSERT INTO teams (hackathonId, name, placement) VALUES (?, 'Time Vivo E2E', 0) RETURNING id")
        .get<{ id: number }>(ED)
    )!;
    ids.team = meu.id;
    for (const u of [me.username, "vivo_par"]) {
      await db.prepare("INSERT INTO team_members (teamId, username) VALUES (?, ?)").run(ids.team, u);
    }
    await db
      .prepare(
        `INSERT INTO team_projects (teamId, title, tagline, description, priorWork, technologies, repoUrl, continuesTeamId, continuedAt)
         VALUES (?, 'Feira Viva E2E', 'a feira do bairro no celular', 'Mostra as barracas abertas agora.',
                 'o protótipo da feira do ano passado, só o mapa', '["Next.js"]', 'https://github.com/e2e-dossie/limpo', ?, ?)`,
      )
      .run(ids.team, ids.anterior, dbTime(Date.now() - 20 * DAY));
    // commits de 3 semanas diferentes: o contador de semanas tem o que contar
    await db
      .prepare(
        `INSERT INTO project_dossiers (teamId, repoUrl, commits, collectedAt, attemptedAt)
         VALUES (?, 'https://github.com/e2e-dossie/limpo', ?, ?, ?)`,
      )
      .run(
        ids.team,
        JSON.stringify(
          [1, 2, 3].map((k) => ({ sha: `abc000${k}`, date: dbTime(Date.now() - k * 7 * DAY), author: "time", message: `semana ${k}` })),
        ),
        dbTime(Date.now()),
        dbTime(Date.now()),
      );

    // time de outra pessoa: o membro de teste só segue (não posta)
    const seguido = (
      await db
        .prepare("INSERT INTO teams (hackathonId, name, placement) VALUES (?, 'Time Seguido E2E', 0) RETURNING id")
        .get<{ id: number }>(ED)
    )!;
    ids.seguido = seguido.id;
    await db.prepare("INSERT INTO team_members (teamId, username) VALUES (?, 'vivo_par')").run(ids.seguido);
    await db
      .prepare("INSERT INTO team_projects (teamId, title, tagline, technologies) VALUES (?, 'Painel Seguido E2E', 'painel do time', '[]')")
      .run(ids.seguido);
    await db.prepare("DELETE FROM project_follows WHERE teamId IN (?, ?)").run(ids.team, ids.seguido);
  });

  test.afterAll(cleanup);

  test("integrante posta no diário e o post fica no projeto", async ({ memberPage: page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/p/${ids.team}`);
    const diario = page.getByTestId("project-diary");
    await expect(diario).toBeVisible();
    await expect(diario.getByTestId("diary-empty")).toBeVisible();
    await page.getByLabel("atualização do projeto").fill("primeira versão no ar, com o mapa das barracas");
    await page.getByRole("button", { name: /publicar/ }).click();
    await expect(diario.getByTestId("post-card")).toContainText("primeira versão no ar, com o mapa das barracas", {
      timeout: 15_000,
    });
    const row = await openE2eDb()
      .prepare("SELECT body, teamId FROM posts WHERE teamId = ? ORDER BY id DESC LIMIT 1")
      .get<{ body: string; teamId: number }>(ids.team);
    expect(row!.body).toBe("primeira versão no ar, com o mapa das barracas");
    expect(Number(row!.teamId)).toBe(ids.team);
    await noHorizontalScroll(page);
    await shot(page, "projeto-vivo-diario-390");
  });

  test("selo continuou, semanas construindo e continuação aparecem na página", async ({ memberPage: page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/p/${ids.team}`);
    await expect(page.getByTestId("project-badges")).toContainText("continuou");
    await expect(page.getByTestId("build-weeks")).toContainText(/o time constrói há \d+ semanas/);
    const continua = page.getByTestId("project-continues");
    await expect(continua).toContainText("Feira Antiga E2E");
    await expect(continua).toContainText("o protótipo da feira do ano passado");
    await expect(continua.getByRole("link")).toHaveAttribute("href", `/p/${ids.anterior}`);
    // o time vê quantas pessoas acompanham; o visitante nunca vê o número
    await expect(page.getByTestId("project-followers")).toContainText("pessoas acompanham o projeto");
    await noHorizontalScroll(page);
    await shot(page, "projeto-vivo-selos-390");
  });

  test("/projetos?continuou=1 filtra e o card mostra o selo", async ({ memberPage: page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/projetos?continuou=1&h=${ED}`);
    await expect(page.getByTestId("filter-continuou")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId(`continuou-${ids.team}`)).toBeVisible();
    await expect(page.getByTestId(`continuou-${ids.seguido}`)).toHaveCount(0);
    await noHorizontalScroll(page);
  });

  test("quem não é do time só segue o projeto", async ({ memberPage: page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/p/${ids.seguido}`);
    // sem composer: o diário é do time
    await expect(page.getByTestId("diary-composer")).toHaveCount(0);
    const botao = page.getByTestId("project-follow-button");
    await expect(botao).toHaveText("seguir o projeto");
    await botao.click();
    await expect(botao).toHaveText("seguindo o projeto", { timeout: 15_000 });
    const api = await memberRequest(page);
    const res = await api.post(`/api/projects/${ids.seguido}/follow`);
    expect(res.ok()).toBe(true);
    expect((await res.json()).following).toBe(true);
    // a atualização do projeto seguido entra na aba seguindo da timeline
    await page.goto("/feed?aba=seguindo");
    await expect(page.locator("body")).toContainText("primeira versão no ar", { timeout: 15_000 });
    await noHorizontalScroll(page);
  });

  test("sem conta: diário aberto, sem composer e sem contador de seguidores", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/p/${ids.team}`);
    await expect(page.getByTestId("project-diary")).toContainText("primeira versão no ar");
    await expect(page.getByTestId("diary-composer")).toHaveCount(0);
    await expect(page.getByTestId("project-followers")).toHaveCount(0);
    await expect(page.getByTestId("anon-follow").getByRole("link")).toHaveAttribute(
      "href",
      `/sign-up?redirect_url=${encodeURIComponent(`/p/${ids.team}`)}`,
    );
    await noHorizontalScroll(page);
    await shot(page, "projeto-vivo-anon-390");
  });

  test("atualização de quem não é do time dá 403 na API", async ({ memberPage: page }) => {
    const api = await memberRequest(page);
    const res = await api.post(`/api/projects/${ids.seguido}/updates`, { data: { body: "quero postar aqui" } });
    expect(res.status()).toBe(403);
  });
});
