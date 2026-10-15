import { expect, type Page } from "@playwright/test";
import { E2E_MEMBER_EMAIL, test } from "./auth";
import { openE2eDb } from "./db";

// Auditoria 041, pacote B: "nova edição" no /admin. Hackathon de comunidade nasce
// rascunho (source 'painel') e leva pro painel dela; evento de outro
// organizador vai direto pro radar (source 'admin', semântica do radar) e abre
// na busca do /admin. O membro de teste vira admin só durante este arquivo.

const SHOTS = process.env.E2E_SHOT_DIR;
const CASA = "e2e-criar-casa";
const TERCEIRO = "e2e-criar-terceiro";

async function setRole(role: "admin" | "member") {
  const db = openE2eDb();
  await db.prepare("UPDATE members SET role = ? WHERE email = ?").run(role, E2E_MEMBER_EMAIL);
  await db.prepare("DELETE FROM hackathons WHERE id IN (?, ?)").run(CASA, TERCEIRO);
}

async function noHorizontalScroll(page: Page) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(sw, "scroll horizontal").toBeLessThanOrEqual(iw);
}

test.describe.configure({ mode: "serial" });

test.describe("nova edição pelo /admin", () => {
  test.beforeAll(async ({ request }) => {
    await request.get("/api/health");
    await setRole("admin");
  });
  test.afterAll(async () => {
    await setRole("member");
  });

  test("hackathon de comunidade nasce rascunho, ligado a ela, e abre o painel", async ({ memberPage: page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin");
    await page.locator('select[name="community"]').selectOption("hack-inova");
    await page.getByPlaceholder("hackathon-sorocaba-2027").fill(CASA);
    await page.getByPlaceholder("Hackathon de Sorocaba").fill("E2E Edição da Casa");
    await page.locator('input[name="startsAt"]').fill("2027-03-10T09:00");
    await page.getByRole("button", { name: /criar edição/ }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/h/${CASA}$`));
    const row = await openE2eDb()
      .prepare(
        `SELECT h.active, h.source, h.startsAt, h.organizer, c.slug FROM hackathons h
         JOIN communities c ON c.id = h."communityId" WHERE h.id = ?`,
      )
      .get(CASA);
    expect(row).toEqual({ active: 0, source: "painel", startsAt: "2027-03-10T09:00:00-03:00", organizer: "Hack Inova", slug: "hack-inova" });
  });

  test("evento de outro organizador vai pro radar com link e prêmio", async ({ memberPage: page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin");
    await page.getByPlaceholder("hackathon-sorocaba-2027").fill(TERCEIRO);
    await page.getByPlaceholder("Hackathon de Sorocaba").fill("E2E Hackathon de Terceiro");
    await page.locator('input[name="startsAt"]').fill("2027-04-10T09:00");
    await page.getByText("evento de outro organizador? ponha no radar").click();
    await page.getByPlaceholder("Prefeitura de Sorocaba").fill("Prefeitura E2E");
    await page.locator('select[name="format"]').selectOption("online");
    await page.getByPlaceholder("https://www.sympla.com.br/evento/...").fill("https://www.sympla.com.br/evento/e2e");
    await page.getByPlaceholder("R$ 15 mil").fill("R$ 5 mil");
    await noHorizontalScroll(page);
    if (SHOTS) {
      await page.locator("form").filter({ hasText: "criar edição" }).screenshot({ path: `${SHOTS}/criar-edicao-terceiro-390.png` });
    }
    await page.getByRole("button", { name: /criar edição/ }).click();
    await expect(page).toHaveURL(new RegExp(`/admin\\?q=${TERCEIRO}$`));
    const row = await openE2eDb()
      .prepare("SELECT active, source, organizer, format, registrationUrl, prize FROM hackathons WHERE id = ?")
      .get(TERCEIRO);
    expect(row).toEqual({
      active: 1,
      source: "admin",
      organizer: "Prefeitura E2E",
      format: "online",
      registrationUrl: "https://www.sympla.com.br/evento/e2e",
      prize: "R$ 5 mil",
    });
  });
});
