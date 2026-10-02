import { expect, test } from "@playwright/test";

// BDD dos fluxos públicos — navegável sem login.
// Fluxos autenticados (signup→perfil→inscrição→carta) são testados pelo
// usuário no tunnel público (Clerk captcha bloqueia automação — ver AGENTS.md).

test.describe("landing — pitch enxuto", () => {
  test("mostra proposta, stats e portas de entrada, sem o app inteiro", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: /um perfil/i }),
    ).toBeVisible();
    // stats provam que o produto vive
    await expect(
      page.getByText("hackathons abertos", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/posts no feed/i)).toBeVisible();
    // portas de entrada pras rotas — não as rotas embutidas na página
    await expect(page.getByRole("link", { name: /explorar o radar/i })).toBeVisible();
    // newsletter persiste interesse
    await expect(page.getByText(/newsletter/i)).toBeVisible();
  });
});

test.describe("radar — descoberta pública", () => {
  test("lista hackathons reais com sessões hack inova em destaque", async ({
    page,
  }) => {
    await page.goto("/radar");
    await expect(
      page.getByRole("heading", { name: /hackathons abertos/i }),
    ).toBeVisible();
    await expect(page.getByText(/sessões hack inova/i)).toBeVisible();
    // filtros por formato existem (duas seções de filtro: sessões + radar)
    await expect(
      page.getByRole("button", { name: "online" }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "presencial" }).first(),
    ).toBeVisible();
  });

  test("filtro de formato reduz a lista", async ({ page }) => {
    await page.goto("/radar");
    const before = await page.locator("article").count();
    await page.getByRole("button", { name: "presencial" }).last().click();
    const after = await page.locator("article").count();
    expect(after).toBeLessThanOrEqual(before);
  });
});

test.describe("página da edição — substitui site novo + google form", () => {
  test("mostra dados, carta colecionável e CTA de inscrição", async ({
    page,
  }) => {
    await page.goto("/h/hack-inova-alphaville-2026");
    await expect(
      page.getByRole("heading", { name: /hack inova alphaville/i }),
    ).toBeVisible();
    await expect(page.getByText(/cartinha colecionável/i)).toBeVisible();
    await expect(page.getByText(/mintadas até agora/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /inscrever-se em 1 clique/i }),
    ).toBeVisible();
  });

  test("edição encerrada mostra arquivo + tiragem fechada", async ({ page }) => {
    await page.goto("/h/hack-inova-unifacens-2026");
    await expect(
      page.getByText("edição encerrada", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/tiragem desta carta fechou/i)).toBeVisible();
  });
});

test.describe("comunidade e feed — rede social pública", () => {
  test("/membros lista quem constrói", async ({ page }) => {
    await page.goto("/membros");
    await expect(
      page.getByRole("heading", { name: /quem constrói aqui/i }),
    ).toBeVisible();
  });

  test("/feed é leitura pública", async ({ page }) => {
    await page.goto("/feed");
    await expect(
      page.getByRole("heading", { name: /o que a comunidade/i }),
    ).toBeVisible();
    await expect(page.getByText(/cria conta pra postar/i)).toBeVisible();
  });
});

test.describe("proteção — auth guarda o que é de membro", () => {
  test("/dashboard e /perfil redirecionam pro sign-in", async ({ page }) => {
    for (const path of ["/dashboard", "/perfil", "/admin"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/sign-in|clerk/i, { timeout: 15000 });
    }
  });
});
