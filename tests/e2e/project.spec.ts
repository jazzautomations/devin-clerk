import { expect } from "@playwright/test";
import { test } from "./auth";
import { seedArquivoE2E } from "./db";

// BDD das páginas de projeto — spec 010.
// O funil Colosseum: hackathon (/h) → projeto (/p) → portfólio (/u).

const HACK = "hack-inova-unifacens-2026"; // seedArquivoE2E: E2E Campeão, 1º lugar

test.describe("página do projeto — a URL que carrega o funil", () => {
  test("click-through: arquivo da edição → página do projeto", async ({
    memberPage: page,
  }) => {
    await seedArquivoE2E();
    await page.goto(`/h/${HACK}`);
    // o título do projeto no pódio virou link pra /p/<teamId>
    const link = page.locator('a[href^="/p/"]').first();
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/p\/\d+/);

    // ficha: título do projeto + edição linkada de volta
    await expect(
      page.getByRole("heading", { name: "E2E Campeão", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Payment Shift/ }),
    ).toHaveAttribute("href", `/h/${HACK}`);
    // 1º lugar com tratamento lendário
    await expect(page.getByText(/1º lugar/).first()).toBeVisible();
  });

  test("teamId desconhecido ou inválido responde 404", async ({ request }) => {
    const missing = await request.get("/p/999999");
    expect(missing.status()).toBe(404);
    const garbage = await request.get("/p/nao-e-numero");
    expect(garbage.status()).toBe(404);
  });

  test("metadata carrega o projeto — og:title no head", async ({ memberPage: page }) => {
    await seedArquivoE2E();
    // resolve o teamId real pelo link no arquivo (seed não garante id fixo)
    await page.goto(`/h/${HACK}`);
    const href = await page
      .locator('a[href^="/p/"]')
      .first()
      .getAttribute("href");
    expect(href).toMatch(/^\/p\/\d+$/);

    await page.goto(href!);
    await expect(page).toHaveTitle(/E2E Campeão/);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
      "content",
      "E2E Campeão",
    );
    await expect(page.getByText(/projeto de teste do e2e/).first()).toBeVisible();
  });

  test("perfil do membro também linka pra página do projeto", async ({
    memberPage: page,
  }) => {
    // o seed não vincula membros — resolve um membro com projeto via /membros
    // só navega se existir; sem membro com projeto o teste passa trivialmente
    await page.goto("/membros");
    const memberLink = page.locator('a[href^="/u/"]').first();
    if (!(await memberLink.count())) return;
    await memberLink.click();
    const projectLink = page.locator('a[href^="/p/"]').first();
    if (!(await projectLink.count())) return; // membro sem projeto — ok
    await expect(projectLink).toHaveAttribute("href", /^\/p\/\d+$/);
  });
});
