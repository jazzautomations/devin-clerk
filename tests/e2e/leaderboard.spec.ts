import { expect, test } from "@playwright/test";

// BDD do leaderboard de membros — spec 007.

test.describe("leaderboard — ranking público por xp", () => {
  test("mostra posições numeradas e o #1 em destaque lendário", async ({
    page,
  }) => {
    await page.goto("/membros");
    await expect(
      page.getByRole("heading", { name: /quem tá na frente/i }),
    ).toBeVisible();

    // lista ordenada semanticamente; topo carrega o token lendário (ouro)
    const top = page.locator("li[data-rank='1']");
    await expect(top).toBeVisible();
    await expect(top).toContainText("#1");
    await expect(top).toHaveClass(/lendario/);

    // a linha linka pro perfil público do membro
    await expect(top.getByRole("link").first()).toHaveAttribute(
      "href",
      /^\/u\//,
    );
  });

  test("toggle 'recém-chegados' ordena por entrada e some com o pódio", async ({
    page,
  }) => {
    await page.goto("/membros");
    await page.getByRole("link", { name: /recém-chegados/i }).click();
    await expect(page).toHaveURL(/sort=recent/);
    // ordem cronológica não é mérito — #1 sem ouro
    await expect(page.locator("li[data-rank='1']")).not.toHaveClass(/lendario/);
    // volta pro ranking por xp
    await page.getByRole("link", { name: "por xp" }).click();
    await expect(page).toHaveURL(/\/membros$/);
    await expect(page.locator("li[data-rank='1']")).toHaveClass(/lendario/);
  });
});
