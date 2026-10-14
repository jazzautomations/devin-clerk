import { expect, test, type APIRequestContext } from "@playwright/test";
import { openE2eDb } from "./db";

// Frente O (migration 017) — patrocinadores, opt-in por QR e NPS. O caminho
// logado (relatório, opt-in, resposta, painel) está nos testes de API — login
// real é bloqueado pelo captcha do Clerk. Aqui: logo na página pública e no
// projeto, páginas novas exigem login, APIs 401 JSON, 390px.
const HACK = "e2e-sponsors-jam";
const SPONSOR = "spon-e2e-marca";
const SHOTS = process.env.FEAT_O_SHOTS ?? "test-results/feat-o";
const LOGO =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="48"><rect width="160" height="48" fill="#0c0c0c"/><text x="80" y="31" fill="#d8f4e5" font-family="monospace" font-size="18" text-anchor="middle">MARCA E2E</text></svg>`,
  );

async function seed(request: APIRequestContext): Promise<number> {
  await request.get("/radar"); // força init/migrações no server do e2e
  const db = openE2eDb();
  await db
    .prepare(
      `INSERT INTO hackathons (id, name, organizer, startsAt, endsAt, format, location, registrationUrl, tags, active, source)
       VALUES (?, 'E2E Sponsors Jam', 'Hack Inova E2E', '2026-09-01T12:00:00Z', '2026-09-02T20:00:00Z', 'presencial',
               'São Paulo', 'https://e2e.dev/sponsors', '[]', 1, 'e2e')
       ON CONFLICT (id) DO UPDATE SET active = 1`,
    )
    .run(HACK);
  await db
    .prepare(`INSERT INTO sponsors (id, name, url, tier) VALUES (?, 'Marca E2E', 'https://marca.e2e.dev', 'master') ON CONFLICT (id) DO NOTHING`)
    .run(SPONSOR);
  await db
    .prepare(
      `INSERT INTO edition_sponsors (hackathonId, sponsorId, tier, logoUrl) VALUES (?, ?, 'master', ?)
       ON CONFLICT (hackathonId, sponsorId) DO UPDATE SET logoUrl = excluded.logoUrl`,
    )
    .run(HACK, SPONSOR, LOGO);
  await db
    .prepare(
      `INSERT INTO sponsors (id, name, tier) VALUES ('spon-e2e-apoio', 'Apoio Sem Logo E2E', 'apoio') ON CONFLICT (id) DO NOTHING`,
    )
    .run();
  await db
    .prepare(
      `INSERT INTO edition_sponsors (hackathonId, sponsorId, tier) VALUES (?, 'spon-e2e-apoio', 'apoio') ON CONFLICT DO NOTHING`,
    )
    .run(HACK);
  await db
    .prepare(
      `INSERT INTO challenges (id, hackathonId, sponsor, sponsorId, title, prize)
       VALUES ('chal-e2e-sponsors', ?, 'Marca E2E', ?, 'Desafio da Marca E2E', 'R$ 3 mil')
       ON CONFLICT (id) DO NOTHING`,
    )
    .run(HACK, SPONSOR);
  // modo antigo (sem prazo de entrega): projeto público com o desafio marcado
  const team = await db
    .prepare(
      `INSERT INTO teams (hackathonId, name) VALUES (?, 'Time Logo E2E')
       ON CONFLICT (hackathonId, name) DO UPDATE SET name = excluded.name RETURNING id`,
    )
    .get<{ id: number }>(HACK);
  await db
    .prepare(
      `INSERT INTO team_projects (teamId, title, tagline, description) VALUES (?, 'Projeto Logo E2E', 'com patrocinador', 'descrição')
       ON CONFLICT (teamId) DO NOTHING`,
    )
    .run(team!.id);
  await db
    .prepare("INSERT INTO project_challenges (teamId, challengeId) VALUES (?, 'chal-e2e-sponsors') ON CONFLICT DO NOTHING")
    .run(team!.id);
  return team!.id;
}

const noOverflow = (page: import("@playwright/test").Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

test.describe("patrocinadores na vitrine", () => {
  test("logo e nível na página pública da edição (sem logo, mostra o nome)", async ({ page, request }) => {
    await seed(request);
    await page.goto(`/h/${HACK}`, { waitUntil: "domcontentloaded" });
    const block = page.getByTestId("edition-sponsors");
    await expect(block).toBeVisible();
    await expect(block.getByRole("img", { name: "logo de Marca E2E" })).toBeVisible();
    await expect(block.getByText("Apoio Sem Logo E2E")).toBeVisible();
    await expect(block.getByText("master")).toBeVisible();
    // master vem antes do apoio
    const items = await block.locator("li").allInnerTexts();
    expect(items[0]).toMatch(/master/i);
  });

  test("logo da marca no projeto que entrou no desafio", async ({ page, request }) => {
    const teamId = await seed(request);
    await page.goto(`/p/${teamId}`, { waitUntil: "domcontentloaded" });
    const row = page.getByTestId("project-challenge");
    await expect(row).toContainText("Desafio da Marca E2E");
    await expect(row.getByRole("img", { name: "logo de Marca E2E" })).toBeVisible();
  });

  test("390px sem scroll horizontal na edição e no projeto", async ({ page, request }) => {
    const teamId = await seed(request);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/h/${HACK}`, { waitUntil: "domcontentloaded" });
    expect(await noOverflow(page)).toBeLessThanOrEqual(0);
    await page.getByTestId("edition-sponsors").scrollIntoViewIfNeeded();
    await page.getByTestId("edition-sponsors").screenshot({ path: `${SHOTS}/edicao-patrocinadores-390.png` });
    await page.goto(`/p/${teamId}`, { waitUntil: "domcontentloaded" });
    expect(await noOverflow(page)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${SHOTS}/projeto-logo-390.png`, fullPage: true });
  });
});

test.describe("páginas novas exigem login", () => {
  for (const path of [
    `/h/${HACK}/patrocinador/${SPONSOR}`,
    `/h/${HACK}/nps`,
    `/admin/h/${HACK}/patrocinador/${SPONSOR}`,
    `/admin/h/${HACK}/patrocinadores`,
    `/admin/h/${HACK}/nps`,
  ]) {
    test(`${path} anon vai pro login`, async ({ page, request }) => {
      await seed(request);
      await page.goto(path);
      await expect(page).toHaveURL(/sign-in|clerk/i, { timeout: 15000 });
    });
  }

  test("APIs de patrocinador, opt-in e NPS respondem 401 JSON", async ({ request }) => {
    await seed(request);
    const calls = [
      request.get(`/api/admin/hackathons/${HACK}/sponsors`),
      request.post(`/api/admin/hackathons/${HACK}/sponsors`, { data: { name: "Invasora" } }),
      request.fetch(`/api/admin/hackathons/${HACK}/sponsors/${SPONSOR}`, { method: "PATCH", data: { tier: "apoio" } }),
      request.post(`/api/admin/hackathons/${HACK}/sponsors/${SPONSOR}/people`, { data: { email: "a@b.dev" } }),
      request.get(`/api/admin/hackathons/${HACK}/sponsors/${SPONSOR}/report`),
      request.get(`/api/admin/hackathons/${HACK}/sponsors/${SPONSOR}/report?format=csv`),
      request.get(`/api/hackathons/${HACK}/sponsors/${SPONSOR}/contact`),
      request.post(`/api/hackathons/${HACK}/sponsors/${SPONSOR}/contact`),
      request.delete(`/api/hackathons/${HACK}/sponsors/${SPONSOR}/contact`),
      request.get(`/api/hackathons/${HACK}/nps`),
      request.put(`/api/hackathons/${HACK}/nps`, { data: { score: 10 } }),
      request.get(`/api/admin/hackathons/${HACK}/nps`),
      request.put(`/api/admin/hackathons/${HACK}/nps`, { data: { closesAt: null } }),
      request.post(`/api/cron/deliveries`),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status(), res.url()).toBe(401);
      expect(res.headers()["content-type"]).toContain("application/json");
      expect(await res.json()).toEqual({ error: "Unauthorized" });
    }
    // nada vazou pro banco
    const row = await openE2eDb().prepare("SELECT 1 FROM sponsors WHERE name = 'Invasora'").get();
    expect(row).toBeUndefined();
  });
});
