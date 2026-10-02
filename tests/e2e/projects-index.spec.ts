import { expect, test } from "@playwright/test";

// BDD do índice de projetos — spec 017.
// O "/companies" do Colosseum: tudo que já nasceu, cruzando edições.

const HACK = "hack-inova-unifacens-2026"; // seed: One Day Hospital, 1º lugar

test.describe("/projetos — portfólio público de tudo que nasceu", () => {
  test("renderiza heading, card do seed e click-through pra /p", async ({
    page,
  }) => {
    await page.goto("/projetos");
    await expect(
      page.getByRole("heading", { name: /o que já nasceu aqui/i }),
    ).toBeVisible();

    // card do seed: título linka pra /p/<teamId>, edição linka de volta,
    // badge de 1º lugar com tratamento lendário
    const title = page.getByRole("link", {
      name: "One Day Hospital",
      exact: true,
    });
    await expect(title).toBeVisible();
    await expect(page.getByText(/1º lugar/).first()).toBeVisible();
    await expect(
      page.locator(`a[href="/h/${HACK}"]`).first(),
    ).toBeVisible();

    await title.click();
    await expect(page).toHaveURL(/\/p\/\d+/);
    await expect(
      page.getByRole("heading", { name: "One Day Hospital", exact: true }),
    ).toBeVisible();
  });

  test("header tem link 'projetos' que abre o índice", async ({ page }) => {
    await page.goto("/");
    const link = page
      .locator("header")
      .getByRole("link", { name: "projetos", exact: true });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/projetos$/);
  });

  test("?h= filtra por edição; edição sem projeto cai no empty state", async ({
    page,
  }) => {
    await page.goto(`/projetos?h=${HACK}`);
    await expect(
      page.getByRole("link", { name: "One Day Hospital", exact: true }),
    ).toBeVisible();

    const res = await page.goto("/projetos?h=edicao-que-nao-existe");
    expect(res!.status()).toBe(200);
    await expect(
      page.getByRole("link", { name: "One Day Hospital", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText(/nenhum projeto/i).first()).toBeVisible();
  });

  test("metadata: canonical /projetos e sitemap cobre a rota", async ({
    page,
    request,
  }) => {
    await page.goto("/projetos");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      /\/projetos$/,
    );

    const sm = await request.get("/sitemap.xml");
    expect(sm.status()).toBe(200);
    expect(await sm.text()).toContain("/projetos");
  });
});
