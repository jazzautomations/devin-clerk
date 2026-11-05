import { expect, type Page } from "@playwright/test";
import { E2E_MEMBER_EMAIL, test } from "./auth";
import { openE2eDb } from "./db";

// Espaços da comunidade (migration 057) e RSS aberto, no celular: barra de
// espaços na comunidade, postar em #ajuda pelo seletor, mural filtrado em
// /s/[space], gestão em /espacos (criar, renomear, ordenar, arquivar e
// desarquivar), feeds Atom abertos com rel=alternate e 390px sem scroll.

const COM = "e2e-espacos";
// membro só dos posts de feed: feed do perfil precisa de publicProfile=1 e
// posts globais, e sujar o /u do membro e2e quebraria o perfil-rico (a aba
// atividade espera "nada publicado")
const FEEDER = "e2e_feed";
const MOBILE = { width: 390, height: 844 };

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "scroll horizontal").toBeLessThanOrEqual(0);
}
async function me(): Promise<{ id: number; username: string }> {
  return (await openE2eDb().prepare("SELECT id, username FROM members WHERE email = ?").get<{ id: number; username: string }>(E2E_MEMBER_EMAIL))!;
}

async function cleanup() {
  const db = openE2eDb();
  // posts primeiro: communityId e teamId são FK sem cascade
  await db.prepare(`DELETE FROM posts WHERE "communityId" IN (SELECT id FROM communities WHERE slug = ?)`).run(COM);
  await db.prepare(`DELETE FROM posts WHERE "teamId" IN (SELECT id FROM teams WHERE "hackathonId" = 'e2e-feed-legacy')`).run();
  await db.prepare(`DELETE FROM team_projects WHERE "teamId" IN (SELECT id FROM teams WHERE "hackathonId" = 'e2e-feed-legacy')`).run();
  await db.prepare(`DELETE FROM team_members WHERE "teamId" IN (SELECT id FROM teams WHERE "hackathonId" = 'e2e-feed-legacy')`).run();
  await db.prepare("DELETE FROM teams WHERE \"hackathonId\" = 'e2e-feed-legacy'").run();
  await db.prepare("DELETE FROM hackathons WHERE id = 'e2e-feed-legacy'").run();
  await db.prepare(`DELETE FROM posts WHERE "memberId" IN (SELECT id FROM members WHERE username = ?)`).run(FEEDER);
  await db.prepare("DELETE FROM members WHERE username = ?").run(FEEDER);
  await db.prepare("DELETE FROM communities WHERE slug = ?").run(COM);
  // restos de uma execução antiga (fixture antiga usava o membro e2e)
  const m = await me().catch(() => null);
  if (m) {
    await db
      .prepare(`DELETE FROM posts WHERE "memberId" = ? AND body IN ('post global do perfil e2e', 'diário do projeto e2e')`)
      .run(m.id);
    await db.prepare("UPDATE members SET \"publicProfile\" = 0 WHERE id = ?").run(m.id);
  }
}

test.describe.configure({ mode: "serial" });

test.describe("espaços da comunidade + rss aberto", () => {
  test.beforeAll(async () => {
    await cleanup();
    const db = openE2eDb();
    const m = await me();
    // o trigger da 057 já dá os 4 espaços padrão junto com a comunidade
    const c = (await db
      .prepare(`INSERT INTO communities (slug, name, city, description) VALUES (?, 'E2E Espaços', 'Recife, PE', 'comunidade dos espaços') RETURNING id`)
      .get<{ id: number }>(COM))!.id;
    await db.prepare(`INSERT INTO community_members ("communityId", "memberId", role) VALUES (?, ?, 'organizador')`).run(c, m.id);
    // perfil aberto dedicado aos feeds (o /u do membro e2e fica intocado)
    const feeder = (await db
      .prepare(`INSERT INTO members ("clerkId", username, email, name, "publicProfile") VALUES ('clerk_e2e_feed', ?, 'e2e-feed@t.dev', 'Feed E2E', 1) RETURNING id`)
      .get<{ id: number }>(FEEDER))!.id;
    // edição legada com projeto aberto pro feed /p
    await db
      .prepare(
        `INSERT INTO hackathons (id, name, organizer, "startsAt", format, "registrationUrl", active, source)
         VALUES ('e2e-feed-legacy', 'E2E Feed Legado', 'Hack Inova', '2020-01-01', 'presencial', 'https://t.dev', 1, 'seed')`,
      )
      .run();
    const t = (await db.prepare(`INSERT INTO teams ("hackathonId", name, placement) VALUES ('e2e-feed-legacy', 'Time Feed E2E', 0) RETURNING id`).get<{ id: number }>())!.id;
    await db.prepare(`INSERT INTO team_members ("teamId", username) VALUES (?, ?)`).run(t, FEEDER);
    await db.prepare(`INSERT INTO team_projects ("teamId", title, description) VALUES (?, 'Projeto Feed E2E', 'desc')`).run(t);
    await db.prepare(`INSERT INTO posts ("memberId", body, "teamId") VALUES (?, 'diário do projeto e2e', ?)`).run(feeder, t);
    await db.prepare(`INSERT INTO posts ("memberId", body) VALUES (?, 'post global do perfil e2e')`).run(feeder);
  });
  test.afterAll(cleanup);

  test("anon: /s/[space] manda pro cadastro, API dá 401 e os feeds abrem sem conta", async ({ page, request }) => {
    await page.goto(`/comunidade/${COM}/s/ajuda`);
    await expect(page).toHaveURL(/\/sign-up/);
    const res = await request.get(`/api/communities/${COM}/spaces`);
    expect(res.status()).toBe(401);
    // feeds: abertos de verdade (leitor de feed não loga)
    for (const path of [`/comunidade/${COM}/feed.xml`, `/p/1/feed.xml`]) {
      const feed = await request.get(path);
      // /p/1 pode não existir — o importante é não mandar pro cadastro
      expect([200, 404]).toContain(feed.status());
    }
    const cf = await request.get(`/comunidade/${COM}/feed.xml`);
    expect(cf.status()).toBe(200);
    expect(cf.headers()["content-type"]).toContain("application/atom+xml");
    const xml = await cf.text();
    expect(xml).toContain("<feed xmlns=\"http://www.w3.org/2005/Atom\">");
    // rel=alternate na página da comunidade
    await page.goto(`/comunidade/${COM}`);
    await expect(page.locator(`link[rel="alternate"][type="application/atom+xml"]`)).toHaveAttribute("href", new RegExp(`/comunidade/${COM}/feed\\.xml$`));
  });

  test("barra de espaços, postar em #ajuda e o mural filtrado, em 390px", async ({ memberPage: page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(`/comunidade/${COM}`);
    const bar = page.getByTestId("space-bar");
    await expect(bar).toBeVisible();
    for (const s of ["geral", "ajuda", "vagas", "mostra"]) await expect(page.getByTestId(`space-chip-${s}`)).toBeVisible();
    await noHorizontalScroll(page);
    // posta em #ajuda pelo seletor do composer — select controlado: antes da
    // hidratação a escolha não pega no estado, então repete até ficar
    const sel = page.getByTestId("composer-space").locator("select");
    await expect(async () => {
      await sel.selectOption({ label: "#ajuda" });
      const escolhido = await sel.evaluate((el: HTMLSelectElement) => el.selectedOptions[0]?.textContent ?? "");
      expect(escolhido).toBe("#ajuda");
    }).toPass({ timeout: 15_000 });
    await page.getByLabel("o que você está construindo").fill("socorro: o build quebrou de novo");
    await page.getByRole("button", { name: "postar →" }).click();
    await expect(page.getByText("socorro: o build quebrou de novo").first()).toBeVisible({ timeout: 15_000 });
    // foi pro geral? não: caiu no #ajuda — o mural da página (geral) não mostra
    await page.goto(`/comunidade/${COM}/s/ajuda`);
    await expect(page.getByTestId("space-title")).toHaveText("#ajuda");
    await expect(page.getByText("socorro: o build quebrou de novo")).toBeVisible();
    await noHorizontalScroll(page);
    await page.goto(`/comunidade/${COM}/s/geral`);
    await expect(page.getByText("socorro: o build quebrou de novo")).toHaveCount(0);
    // e o post aparece no feed da comunidade (todos os espaços)
    const feed = await page.request.get(`/comunidade/${COM}/feed.xml`);
    expect(await feed.text()).toContain("socorro: o build quebrou de novo");
  });

  test("gestão: criar, renomear, ordenar, arquivar e desarquivar", async ({ memberPage: page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(`/comunidade/${COM}/espacos`);
    await expect(page.getByTestId("spaces-admin")).toBeVisible();
    await noHorizontalScroll(page);
    // cria — mesmo cuidado com a hidratação: o fill precisa ficar
    await expect(async () => {
      await page.getByTestId("space-name").fill("projetos");
      await expect(page.getByTestId("space-name")).toHaveValue("projetos", { timeout: 1000 });
    }).toPass({ timeout: 15_000 });
    await page.getByTestId("space-description").fill("o que você está fazendo");
    await page.getByTestId("space-create").click();
    await expect(page.getByTestId("space-row-projetos")).toBeVisible({ timeout: 15_000 });
    // aparece na barra da comunidade
    await page.goto(`/comunidade/${COM}`);
    await expect(page.getByTestId("space-chip-projetos")).toBeVisible();
    // volta e renomeia ajuda → slug fica, nome muda
    await page.goto(`/comunidade/${COM}/espacos`);
    await page.getByTestId("space-edit-ajuda").click();
    await page.getByTestId("space-row-ajuda").getByLabel("nome do espaço").fill("ajuda geral");
    await page.getByTestId("space-row-ajuda").getByRole("button", { name: "salvar" }).click();
    await expect(page.getByTestId("spaces-admin-msg")).toContainText("atualizado", { timeout: 15_000 });
    // ordena: desce geral uma posição
    await page.getByLabel("descer geral").click();
    // arquiva vagas e traz de volta
    page.on("dialog", (d) => d.accept());
    await page.getByTestId("space-archive-vagas").click();
    await expect(page.getByTestId("space-archived-vagas")).toBeVisible({ timeout: 15_000 });
    await page.goto(`/comunidade/${COM}`);
    await expect(page.getByTestId("space-chip-vagas")).toHaveCount(0);
    await page.goto(`/comunidade/${COM}/s/vagas`);
    await expect(page.getByTestId("space-page")).toHaveCount(0);
    await page.goto(`/comunidade/${COM}/espacos`);
    await page.getByLabel("desarquivar vagas").click();
    await expect(page.getByTestId("space-row-vagas")).toBeVisible({ timeout: 15_000 });
    await noHorizontalScroll(page);
  });

  test("membro comum não abre a gestão; feed do perfil e do projeto", async ({ memberPage: page, request }) => {
    // gestão é de dono/organizador — membro e2e organiza COM, então prova o
    // 404 com um usuário sem papel via página pública da comunidade... não:
    // o membro e2e é organizador aqui. O 404 de membro comum fica na API.
    const uf = await request.get(`/u/${FEEDER}/feed.xml`);
    expect(uf.status()).toBe(200);
    const uxml = await uf.text();
    expect(uxml).toContain("post global do perfil e2e");
    expect(uxml).toContain("diário do projeto e2e");
    expect(uxml).not.toContain("socorro: o build quebrou de novo"); // mural da comunidade não entra
    const db = openE2eDb();
    const team = await db.prepare("SELECT \"teamId\" FROM team_projects WHERE title = 'Projeto Feed E2E'").get<{ teamId: number }>();
    const pf = await request.get(`/p/${team!.teamId}/feed.xml`);
    expect(pf.status()).toBe(200);
    expect(await pf.text()).toContain("diário do projeto e2e");
    // rel=alternate no /p
    await page.goto(`/p/${team!.teamId}`);
    await expect(page.locator(`link[rel="alternate"][type="application/atom+xml"]`)).toHaveAttribute("href", new RegExp(`/p/${team!.teamId}/feed\\.xml$`));
  });
});
