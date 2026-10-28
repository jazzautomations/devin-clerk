import { expect } from "@playwright/test";
import { test } from "./auth";

// /membros — spec 007, revista na 046 (seguir pessoas): a ordem pode seguir
// o xp, mas sem pódio, sem posição numerada e sem destaque de ranking.

test.describe("membros — lista sem placar", () => {
  test("sem posição (#1) nem pódio; cada linha linka pro perfil", async ({ memberPage: page }) => {
    await page.goto("/membros");
    await expect(page.getByRole("heading", { name: /quem constrói aqui/i })).toBeVisible();
    await expect(page.locator("[data-rank]")).toHaveCount(0);
    await expect(page.locator("main")).not.toContainText(/#\d+\b/);
    await expect(page.locator("main li[class*='lendario']")).toHaveCount(0);
    await expect(page.locator('main li a[href^="/u/"]').first()).toBeVisible();
  });

  test("toggle 'recém-chegados' troca a ordem e volta pra 'por xp'", async ({ memberPage: page }) => {
    await page.goto("/membros");
    await page.getByRole("link", { name: /recém-chegados/i }).click();
    await expect(page).toHaveURL(/sort=recent/);
    await expect(page.getByRole("link", { name: /recém-chegados/i })).toHaveAttribute("aria-current", "page");
    await page.getByRole("link", { name: "por xp" }).click();
    await expect(page).toHaveURL(/\/membros$/);
    await expect(page.getByRole("link", { name: "por xp" })).toHaveAttribute("aria-current", "page");
  });
});
