import { expect, type APIRequestContext } from "@playwright/test";
import { test } from "./auth";
import { openE2eDb } from "./db";

// Radar global (migration 026): seções "No Brasil" (por UF) → "Online e
// abertos pra brasileiros" → "Presencial lá fora" → "Não informado se
// brasileiro pode" → "Não aceitam brasileiros"; filtros por onde, formato,
// brasileiro pode, prazo, prêmio e tema; selos no card. A landing mistura
// Brasil com o global grande aberto pra brasileiro, sem o que fecha em 48h.
// Eventos próprios (source='e2e') não colidem com seed nem raspados.
const PE = "e2e-recife-jam";
const ONLINE_BR = "e2e-online-br-jam";
const GLOBAL = "e2e-global-aberto";
const ONLINE = "e2e-online-jam";
const FECHADO = "e2e-global-fechado";
const EXTERIOR = "e2e-lisbon-jam";
const SOON = "e2e-amanha-jam";

async function ensureRadarEvents(request: APIRequestContext) {
  // força o init/migrações do db no server
  await request.get("/api/health");
  const db = openE2eDb();
  const day = 86_400_000;
  const future = new Date(Date.now() + 30 * day).toISOString();
  const tomorrow = new Date(Date.now() + day).toISOString();
  const in3 = new Date(Date.now() + 3.5 * day).toISOString();
  const insert = db.prepare(
    `INSERT INTO hackathons
       (id, name, organizer, startsAt, format, location, registrationUrl,
        tags, active, source, region, prize, scope, country, brazilOk,
        eligibilityNote, eligibilityUrl, prizeUsd, registrationDeadline)
     VALUES (?, ?, 'E2E Org', ?, ?, ?, 'https://e2e.dev/x', '["ia"]', 1, 'e2e', ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET startsAt = excluded.startsAt,
       location = excluded.location, region = excluded.region,
       prize = excluded.prize, scope = excluded.scope, country = excluded.country,
       brazilOk = excluded.brazilOk, eligibilityNote = excluded.eligibilityNote,
       eligibilityUrl = excluded.eligibilityUrl, prizeUsd = excluded.prizeUsd,
       registrationDeadline = excluded.registrationDeadline, active = 1`,
  );
  await insert.run(PE, "E2E Recife Jam", future, "presencial", "Recife, PE", "br", null, "cidade", "Brasil", "sim", "Acontece no Brasil.", null, null, null);
  await insert.run(ONLINE_BR, "E2E Maratona Online", future, "online", null, "online-br", "R$ 5 mil", "brasil", null, "sim", null, null, 900, null);
  await insert.run(
    GLOBAL, "E2E Global Aberto", future, "online", null, "online-mundo", "$50,000", "global", null, "sim",
    "All countries/territories, excluding: North Korea", "https://e2e.dev/rules", 50000, in3,
  );
  await insert.run(ONLINE, "E2E Online Jam", future, "online", null, "online-mundo", "₹ 90,000", "global", null, null, null, null, 1080, null);
  await insert.run(
    FECHADO, "E2E Global Fechado", future, "online", null, "online-mundo", "$138,000", "global", null, "nao",
    "All countries/territories, excluding: Brazil, Cuba", "https://e2e.dev/rules", 138000, null,
  );
  await insert.run(EXTERIOR, "E2E Lisbon Jam", future, "presencial", "Lisboa, Portugal", "exterior", null, "cidade", "Portugal", null, null, null, null, null);
  await insert.run(SOON, "E2E Amanha Jam", tomorrow, "presencial", "Recife, PE", "br", null, "cidade", "Brasil", "sim", null, null, null, null);
}

const card = (page: import("@playwright/test").Page, name: string) => page.locator("article", { hasText: name });

test.describe("radar — Brasil e mundo", () => {
  test("seções na ordem e cada evento no seu lugar", async ({ memberPage: page, request }) => {
    await ensureRadarEvents(request);
    await page.goto("/radar");
    const titles = await page.locator("[data-testid^='radar-secao-'] h2").allInnerTexts();
    const order = titles.map((t) => t.replace(/\s*\d+$/, "").trim());
    expect(order).toEqual([
      "No Brasil",
      "Online e abertos pra brasileiros",
      "Presencial lá fora",
      "Não informado se brasileiro pode",
      "Não aceitam brasileiros",
    ]);
    await expect(page.getByTestId("radar-secao-brasil").locator("article", { hasText: "E2E Recife Jam" })).toHaveCount(1);
    await expect(page.getByTestId("radar-secao-online-aberto").locator("article", { hasText: "E2E Global Aberto" })).toHaveCount(1);
    await expect(page.getByTestId("radar-secao-nao-informado").locator("article", { hasText: "E2E Online Jam" })).toHaveCount(1);
    await expect(page.getByTestId("radar-secao-lafora").locator("article", { hasText: "E2E Lisbon Jam" })).toHaveCount(1);
    // quem exclui o Brasil fica fechado no fim, abre no clique
    const fechado = page.getByTestId("radar-secao-fechado");
    await expect(fechado.locator("article", { hasText: "E2E Global Fechado" })).toBeHidden();
    await fechado.locator("summary").click();
    await expect(fechado.locator("article", { hasText: "E2E Global Fechado" })).toBeVisible();
  });

  test("selos curtos no card", async ({ memberPage: page, request }) => {
    await ensureRadarEvents(request);
    await page.goto("/radar");
    const selos = card(page, "E2E Global Aberto").getByTestId("radar-selos");
    await expect(selos).toContainText("online · global");
    await expect(selos).toContainText("aberto pra brasileiros");
    await expect(selos).toContainText("fecha em 3 dias");
    await expect(card(page, "E2E Global Aberto").getByText("US$ 50 mil", { exact: true })).toBeVisible();
    await expect(card(page, "E2E Recife Jam").getByTestId("radar-selos")).toContainText("presencial · PE");
    await expect(card(page, "E2E Lisbon Jam").getByTestId("radar-selos")).toContainText("presencial · Portugal");
  });

  test("filtros: onde, estado, aberto pra brasileiros, prêmio e tema", async ({ memberPage: page, request }) => {
    await ensureRadarEvents(request);
    await page.goto("/radar");
    const filtros = page.getByTestId("radar-filtros");

    await filtros.getByRole("button", { name: /^global/ }).click();
    await expect(card(page, "E2E Global Aberto")).toHaveCount(1);
    await expect(card(page, "E2E Recife Jam")).toHaveCount(0);
    await expect(card(page, "E2E Lisbon Jam")).toHaveCount(0);

    await filtros.getByRole("button", { name: "aberto pra brasileiros" }).click();
    await expect(card(page, "E2E Global Aberto")).toHaveCount(1);
    await expect(card(page, "E2E Online Jam")).toHaveCount(0);
    await expect(page.getByTestId("radar-secao-fechado")).toHaveCount(0);

    await filtros.getByRole("button", { name: "US$ 10 mil ou mais" }).click();
    await expect(card(page, "E2E Global Aberto")).toHaveCount(1);
    await expect(card(page, "E2E Maratona Online")).toHaveCount(0);

    await filtros.getByRole("button", { name: /^outros países/ }).click();
    await filtros.getByRole("button", { name: "aberto pra brasileiros" }).click();
    await filtros.getByRole("button", { name: "US$ 10 mil ou mais" }).click();
    await expect(card(page, "E2E Lisbon Jam")).toHaveCount(1);
    await expect(card(page, "E2E Global Aberto")).toHaveCount(0);

    await filtros.getByRole("button", { name: "todos" }).first().click();
    await filtros.getByRole("button", { name: "pe", exact: true }).click();
    await expect(card(page, "E2E Recife Jam")).toHaveCount(1);
    await expect(card(page, "E2E Online Jam")).toHaveCount(0);
    await filtros.getByRole("button", { name: "pe", exact: true }).click();

    await filtros.getByRole("button", { name: "#ia" }).click();
    await expect(card(page, "E2E Global Aberto")).toHaveCount(1);
  });

  test("390px sem scroll horizontal", async ({ memberPage: page, request }) => {
    await ensureRadarEvents(request);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/radar");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("página do evento: alcance, regra com link, prazo, prêmio e CTA oficial", async ({ memberPage: page, request }) => {
    await ensureRadarEvents(request);
    await page.goto(`/h/${GLOBAL}`);
    const fatos = page.getByTestId("radar-fatos");
    await expect(fatos).toContainText("online · global");
    await expect(fatos.getByTestId("radar-brasileiro-pode")).toHaveText("Sim");
    await expect(fatos).toContainText("excluding: North Korea");
    await expect(fatos.getByRole("link", { name: /ler a regra/ })).toHaveAttribute("href", "https://e2e.dev/rules");
    await expect(fatos).toContainText("US$ 50 mil");
    await expect(fatos.getByTestId("radar-cta-oficial")).toHaveAttribute("href", "https://e2e.dev/x");

    await page.goto(`/h/${ONLINE}`);
    await expect(page.getByTestId("radar-brasileiro-pode")).toHaveText("Não informado");
    await page.setViewportSize({ width: 390, height: 844 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("landing — Brasil + global aberto pra brasileiro", () => {
  test("amostra mistura Brasil e global; esconde sem regra, fechado, lá fora e quem fecha amanhã", async ({ page, request }) => {
    await ensureRadarEvents(request);
    await page.goto("/");
    const lista = page.getByTestId("landing-proximas");
    await expect(lista).toBeVisible();
    await expect(lista.locator("li")).toHaveCount(4);
    await expect(lista.getByText("E2E Global Aberto")).toHaveCount(1);
    await expect(lista.getByText("aberto pra brasileiros")).toHaveCount(1);
    for (const n of ["E2E Online Jam", "E2E Global Fechado", "E2E Lisbon Jam", "E2E Amanha Jam"]) {
      await expect(lista.getByText(n)).toHaveCount(0);
    }
    // Hack Inova (edição com inscrição aqui) abre a lista
    await expect(lista.locator("li").first().getByText("inscrição no HackaHub")).toBeVisible();
    await expect(page.getByTestId("landing-radar-completo")).toContainText(/no radar completo/);
    await page.setViewportSize({ width: 390, height: 844 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
