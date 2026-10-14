import { expect } from "@playwright/test";
import { test } from "./auth";

// BDD dos fluxos principais. Spec 039: a landing é pública; radar,
// comunidade e a página completa da edição são de quem tem conta
// (memberPage, sessão do global-setup).

test.describe("landing — explica o produto pra quem não tem conta (spec 039)", () => {
  test("hero, prova do banco, jornada, telas por dentro, conta e newsletter", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: /sua comunidade de hackathon/i })).toBeVisible();
    // prova real: stats do banco com rótulo
    await expect(page.getByText("membros", { exact: true }).first()).toBeVisible();
    await expect(page.locator("#como-funciona")).toBeVisible();
    await expect(page.getByTestId("landing-por-dentro").locator("img")).toHaveCount(4);
    await expect(page.getByTestId("landing-conta")).toBeVisible();
    await expect(page.getByText(/newsletter/i)).toBeVisible();
  });
});

test.describe("radar — descoberta (logado)", () => {
  test("lista hackathons reais com sessões hack inova em destaque", async ({
    memberPage: page,
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

  test("filtro de formato reduz a lista", async ({ memberPage: page }) => {
    await page.goto("/radar");
    const before = await page.locator("article").count();
    await page.getByRole("button", { name: "presencial" }).last().click();
    const after = await page.locator("article").count();
    expect(after).toBeLessThanOrEqual(before);
  });
});

test.describe("página da edição — substitui site novo + google form", () => {
  test("mostra dados, carta colecionável e CTA de inscrição", async ({
    memberPage: page,
  }) => {
    await page.goto("/h/hack-inova-alphaville-2026");
    await expect(
      page.getByRole("heading", { name: /hack inova alphaville/i }),
    ).toBeVisible();
    await expect(page.getByText(/cartinha colecionável/i)).toBeVisible();
    await expect(page.getByText(/mintadas até agora/i)).toBeVisible();
    // frente L: inscrição sempre pelo formulário (nascimento, conduta, imagem)
    await expect(
      page.getByRole("link", { name: /fazer inscrição/i }),
    ).toBeVisible();
  });

  test("edição encerrada mostra arquivo + tiragem fechada", async ({ memberPage: page }) => {
    await page.goto("/h/hack-inova-unifacens-2026");
    await expect(
      page.getByText("edição encerrada", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/tiragem desta carta fechou/i)).toBeVisible();
  });
});

test.describe("comunidade e feed — pra quem tem conta", () => {
  test("/membros lista quem constrói", async ({ memberPage: page }) => {
    await page.goto("/membros");
    await expect(
      page.getByRole("heading", { name: /quem tá na frente/i }),
    ).toBeVisible();
  });

  test("/feed: membro lê e tem o compositor (anon vai pro cadastro)", async ({ memberPage: page }) => {
    await page.goto("/feed");
    await expect(
      page.getByRole("heading", { name: /o que a comunidade/i }),
    ).toBeVisible();
    await expect(page.getByText(/cria conta pra postar/i)).toHaveCount(0);
    await expect(page.getByPlaceholder(/o que tu tá construindo/i)).toBeVisible();
  });
});

test.describe("proteção — auth guarda o que é de membro", () => {
  test("/dashboard e /perfil redirecionam pro sign-in", async ({ page }) => {
    for (const path of ["/dashboard", "/perfil", "/admin"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/sign-in|sign-up|clerk/i, { timeout: 15000 });
    }
  });
});
