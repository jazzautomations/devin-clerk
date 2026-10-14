import { expect, type APIRequestContext } from "@playwright/test";
import { test } from "./auth";
import { openE2eDb } from "./db";

// Radar Brasil-first: seções "No Brasil" (por UF) → "Online em português"
// → "Online no mundo" → "Presencial lá fora", com filtro de onde/estado.
// A landing só leva Hack Inova + Brasil, sem gringo e sem o que fecha em 48h.
// Eventos próprios (source='e2e' + region) não colidem com seed nem raspados.
const PE = "e2e-recife-jam";
const ONLINE_BR = "e2e-online-br-jam";
const ONLINE = "e2e-online-jam";
const EXTERIOR = "e2e-lisbon-jam";
const SOON = "e2e-amanha-jam";

async function ensureRegionEvents(request: APIRequestContext) {
  // força o init/migrações do db no server
  await request.get("/api/health");
  const db = openE2eDb();
  const day = 86_400_000;
  const future = new Date(Date.now() + 30 * day).toISOString();
  const tomorrow = new Date(Date.now() + day).toISOString();
  const insert = db.prepare(
    `INSERT INTO hackathons
       (id, name, organizer, startsAt, format, location, registrationUrl,
        tags, active, source, region, prize)
     VALUES (?, ?, 'E2E Org', ?, ?, ?, 'https://e2e.dev/x', '[]', 1, 'e2e', ?, ?)
     ON CONFLICT(id) DO UPDATE SET startsAt = excluded.startsAt,
       location = excluded.location, region = excluded.region,
       prize = excluded.prize, active = 1`,
  );
  await insert.run(PE, "E2E Recife Jam", future, "presencial", "Recife, PE", "br", null);
  await insert.run(ONLINE_BR, "E2E Maratona Online", future, "online", null, "online-br", "R$ 5 mil");
  await insert.run(ONLINE, "E2E Online Jam", future, "online", null, "online-mundo", "₹ 90,000");
  await insert.run(EXTERIOR, "E2E Lisbon Jam", future, "presencial", "Lisboa, Portugal", "exterior", null);
  await insert.run(SOON, "E2E Amanha Jam", tomorrow, "presencial", "Recife, PE", "br", null);
}

test.describe("radar — Brasil primeiro", () => {
  test("seções na ordem Brasil → online BR → online mundo → lá fora", async ({ memberPage: page, request }) => {
    await ensureRegionEvents(request);
    await page.goto("/radar");
    const titles = await page.locator("[data-testid^='radar-secao-'] h2").allInnerTexts();
    const order = titles.map((t) => t.replace(/\s*\d+$/, "").trim());
    expect(order).toEqual(["No Brasil", "Online em português", "Online no mundo", "Presencial lá fora"]);
    await expect(page.getByTestId("radar-secao-br").locator("article", { hasText: "E2E Recife Jam" })).toHaveCount(1);
    await expect(page.getByTestId("radar-secao-online-mundo").locator("article", { hasText: "E2E Online Jam" })).toHaveCount(1);
  });

  test("filtro por onde e por estado", async ({ memberPage: page, request }) => {
    await ensureRegionEvents(request);
    await page.goto("/radar");
    const filtros = page.getByTestId("radar-filtros");
    await filtros.getByRole("button", { name: /^online no mundo/ }).click();
    await expect(page.locator("article", { hasText: "E2E Online Jam" })).toHaveCount(1);
    await expect(page.locator("[data-testid^='radar-secao-']", { hasText: "E2E Recife Jam" })).toHaveCount(0);

    await filtros.getByRole("button", { name: "pe", exact: true }).click();
    await expect(page.locator("article", { hasText: "E2E Recife Jam" })).toHaveCount(1);
    await expect(page.locator("article", { hasText: "E2E Online Jam" })).toHaveCount(0);
    await expect(page.locator("article", { hasText: "E2E Lisbon Jam" })).toHaveCount(0);

    // toggle do mesmo chip limpa o filtro
    await filtros.getByRole("button", { name: "pe", exact: true }).click();
    await expect(page.locator("article", { hasText: "E2E Online Jam" })).toHaveCount(1);
  });

  test("390px sem scroll horizontal", async ({ memberPage: page, request }) => {
    await ensureRegionEvents(request);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/radar");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("landing — próximas edições só com Brasil", () => {
  test("mostra Brasil e online em português; esconde gringo, lá fora e quem fecha amanhã", async ({ page, request }) => {
    await ensureRegionEvents(request);
    await page.goto("/");
    const lista = page.getByTestId("landing-proximas");
    await expect(lista).toBeVisible();
    await expect(lista.getByText("E2E Online Jam")).toHaveCount(0);
    await expect(lista.getByText("E2E Lisbon Jam")).toHaveCount(0);
    await expect(lista.getByText("E2E Amanha Jam")).toHaveCount(0);
    await expect(lista.getByText("₹")).toHaveCount(0);
    // Hack Inova vem antes do radar
    const first = lista.locator("li").first();
    await expect(first.getByText("edição hack inova")).toBeVisible();
  });
});
