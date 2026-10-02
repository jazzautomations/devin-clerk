import { expect, test } from "@playwright/test";

// BDD do arquivo de edições — spec 003.

test.describe("arquivo da edição — prova pública do evento", () => {
  test("edição encerrada mostra pódio com o vencedor real", async ({
    page,
  }) => {
    await page.goto("/h/hack-inova-unifacens-2026");
    await expect(page.getByText("resultado")).toBeVisible();
    // pódio em destaque, 1º lugar identificado
    await expect(page.getByText("1º")).toBeVisible();
    await expect(page.getByText("One Day Hospital").first()).toBeVisible();
  });

  test("edição futura NÃO mostra seção de resultado", async ({ page }) => {
    await page.goto("/h/hack-inova-alphaville-2026");
    await expect(page.getByText("resultado")).not.toBeVisible();
  });

  test("edição passada sem dados mostra empty state honesto", async ({
    page,
  }) => {
    await page.goto("/h/hackinova-os-2-anhembi-2026");
    await expect(
      page.getByText(/arquivo em organização/i),
    ).toBeVisible();
  });
});
