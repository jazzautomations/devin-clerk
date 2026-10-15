import { expect } from "@playwright/test";
import { test } from "./auth";
import { seedArquivoE2E } from "./db";


// BDD do arquivo de edições — spec 003.

test.describe("arquivo da edição — prova pública do evento", () => {
  test("edição encerrada mostra pódio com o vencedor real", async ({
    memberPage: page,
  }) => {
    await seedArquivoE2E();
    await page.goto("/h/hack-inova-unifacens-2026");
    await expect(page.getByRole("heading", { name: "Resultado" })).toBeVisible();
    // pódio em destaque, 1º lugar identificado
    await expect(page.getByText("1º").first()).toBeVisible();
    await expect(page.getByText("E2E Campeão").first()).toBeVisible();
  });

  test("edição futura NÃO mostra seção de resultado", async ({ memberPage: page }) => {
    await page.goto("/h/hack-inova-alphaville-2026");
    await expect(page.getByRole("heading", { name: "Resultado" })).not.toBeVisible();
  });

  test("edição passada sem dados mostra empty state honesto", async ({
    memberPage: page,
  }) => {
    await page.goto("/h/hackinova-os-2-anhembi-2026");
    await expect(
      page.getByText(/arquivo em organização/i),
    ).toBeVisible();
  });
});
