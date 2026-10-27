import { expect, type Page } from "@playwright/test";
import { test } from "./auth";
import { openE2eDb } from "./db";

// spec 039 — landing que explica o produto, /organizar, allowlist de acesso,
// teaser da edição, cartões públicos, onboarding e o painel "próximo passo".

const NEXT = "hack-inova-alphaville-2026";

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe("landing pública", () => {
  test("CTA primário cadastra e o secundário cria a comunidade", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("hero-cta-primary")).toHaveText(/entrar na comunidade/i);
    await expect(page.getByTestId("hero-cta-criar")).toHaveAttribute("href", "/comunidades/nova");
    // o que está aberto aparece já na primeira dobra, edição com inscrição aqui primeiro
    await expect(page.getByTestId("landing-proximas")).toContainText(/hack inova/i);
  });

  test("narrativa: radar, comunidades, organizar, perfil, dúvidas e conta", async ({ page }) => {
    await page.goto("/");
    for (const id of ["landing-proximas", "landing-comunidades", "landing-organizar", "landing-perfil", "landing-conta", "landing-faq"]) {
      await expect(page.getByTestId(id)).toBeVisible();
    }
    await expect(page.getByTestId("landing-organizar-cta")).toHaveAttribute("href", "/comunidades/nova");
    await expect(page.getByTestId("landing-organizar").getByRole("link", { name: /passo a passo/i })).toHaveAttribute("href", "/organizar");
    await expect(page.getByTestId("landing-organizar").locator("img")).toHaveCount(4);
    // dúvidas de quem organiza, com a resposta que é verdade hoje
    const faqBox = page.getByTestId("landing-faq");
    await expect(faqBox.getByText("Como crio minha comunidade?")).toBeVisible();
    await faqBox.getByText("Quanto custa organizar?").click();
    await expect(faqBox.getByText(/Hoje é grátis/)).toBeVisible();
    // FAQ abre e fecha
    const q = page.getByTestId("landing-faq").locator("summary").first();
    await q.click();
    await expect(page.getByTestId("landing-faq").locator("details").first()).toHaveAttribute("open", "");
  });

  test("header de quem não tem conta: o que explica o produto, sem link pra área logada", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Navegação principal" });
    await expect(nav.getByRole("link", { name: "comunidades" })).toHaveAttribute("href", "/#comunidades");
    await expect(nav.getByRole("link", { name: "organizar" })).toHaveAttribute("href", "/organizar");
    await expect(nav.getByRole("link", { name: "patrocinar" })).toHaveAttribute("href", "/empresas");
    await expect(nav.getByRole("link", { name: "hackathons" })).toHaveCount(0);
    await expect(page.locator("header").getByRole("button", { name: "criar conta" })).toBeVisible();
  });

  test("390px: menu mobile abre, mostra os links, fecha no Esc; sem scroll horizontal", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await noHorizontalScroll(page);
    const toggle = page.getByRole("button", { name: "menu", exact: true });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(async () => {
      await toggle.click();
      await expect(page.getByRole("button", { name: "fechar", exact: true })).toHaveAttribute("aria-expanded", "true", { timeout: 1000 });
    }).toPass({ timeout: 15000 });
    const menu = page.getByRole("navigation", { name: "Navegação principal (menu)" });
    await expect(menu.getByRole("link", { name: /organizar/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
  });

  test("membro logado vê a nav da plataforma com estado ativo", async ({ memberPage: page }) => {
    await page.goto("/radar");
    const link = page.getByRole("navigation", { name: "Navegação principal" }).getByRole("link", { name: "hackathons" });
    await expect(link).toHaveAttribute("aria-current", "page");
  });
});

test.describe("/organizar", () => {
  test("self-service: hero, 4 passos com print real, patrocínio e contato pra dúvida", async ({ page }) => {
    await page.goto("/organizar");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/crie sua comunidade/i);
    await expect(page.getByTestId("organizar-cta-criar")).toHaveAttribute("href", "/comunidades/nova");
    await expect(page.getByText(/Hoje é grátis/).first()).toBeVisible();
    await expect(page.getByText(/fale com a Hack Inova/i)).toHaveCount(0);
    await expect(page.getByTestId("organizar-passo")).toHaveCount(4);
    await expect(page.getByTestId("organizar-passo").locator("img")).toHaveCount(4);
    for (const img of await page.getByTestId("organizar-passo").locator("img").all()) {
      expect(await img.getAttribute("alt")).toBeTruthy();
    }
    await expect(page.locator("#patrocinio")).toBeVisible();
    await expect(page.getByTestId("organizar-cta-contato")).toHaveAttribute("href", "#contato");
  });

  test("contato vira lead 'organizar' na fila do admin", async ({ page }) => {
    await page.goto("/organizar");
    const email = `org-${Date.now()}@faculdade.edu.br`;
    await page.getByLabel(/instituição ou comunidade/i).fill("Faculdade E2E");
    await page.getByLabel(/e-mail/i).fill(email);
    await page.getByLabel(/sua dúvida/i).fill("dá pra ter duas sedes no mesmo hackathon?");
    await expect(async () => {
      await page.getByRole("button", { name: /quero conversar/i }).click();
      await expect(page.getByText(/recebido/i)).toBeVisible({ timeout: 3000 });
    }).toPass({ timeout: 20000 });
    const row = await openE2eDb().prepare("SELECT interest FROM leads WHERE email = ?").get<{ interest: string }>(email);
    expect(row?.interest).toBe("organizar");
  });

  test("390px sem scroll horizontal", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/organizar");
    await noHorizontalScroll(page);
  });
});

test.describe("acesso — allowlist (spec 039)", () => {
  const PUBLICAS = ["/", "/organizar", "/empresas", "/legal/termos", "/legal/privacidade", `/h/${NEXT}`, `/h/${NEXT}/conduta`, `/h/${NEXT}/incidente`, "/sitemap.xml", "/robots.txt", "/api/health", "/comunidade/hack-inova"];
  const PRIVADAS = ["/radar", "/feed", "/membros", "/projetos", "/talento", "/blog", "/dashboard", "/perfil", "/bem-vindo", "/notificacoes", `/h/${NEXT}/inscricao`, `/h/${NEXT}/programacao`, `/h/${NEXT}/projetos`, "/comunidades", "/comunidades/nova", "/comunidade/hack-inova/editar", "/comunidade/hack-inova/hackathon/novo"];

  for (const p of PUBLICAS) {
    test(`${p} abre sem login (200)`, async ({ request }) => {
      expect((await request.get(p, { maxRedirects: 0 })).status()).toBe(200);
    });
  }
  for (const p of PRIVADAS) {
    test(`${p} sem login → 307 pro cadastro com redirect_url`, async ({ request }) => {
      const res = await request.get(p, { maxRedirects: 0 });
      expect(res.status()).toBe(307);
      expect(res.headers()["location"]).toContain(`/sign-up?redirect_url=${encodeURIComponent(p)}`);
    });
  }
  test("API privada sem sessão → 401 JSON, nunca redirect", async ({ request }) => {
    for (const p of ["/api/posts", "/api/hackathons", "/api/roadmap", "/api/onboarding", "/api/communities", "/api/communities/hack-inova"]) {
      const res = await request.get(p, { maxRedirects: 0 });
      expect(res.status(), p).toBe(401);
      expect(await res.json()).toEqual({ error: "Unauthorized" });
    }
  });
  test("logado vê as páginas privadas", async ({ memberPage: page }) => {
    for (const p of ["/radar", "/membros", "/projetos", "/feed"]) {
      await page.goto(p);
      await expect(page).toHaveURL(new RegExp(`${p}$`));
    }
  });
});

test.describe("edição — teaser público × página completa", () => {
  test("anon vê o teaser e o CTA cria conta e volta pra inscrição", async ({ page }) => {
    await page.goto(`/h/${NEXT}`);
    await expect(page.getByTestId("edition-teaser")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: /hack inova alphaville/i })).toBeVisible();
    await expect(page.getByTestId("teaser-signup")).toHaveAttribute("href", `/sign-up?redirect_url=${encodeURIComponent(`/h/${NEXT}/inscricao`)}`);
    // o resto é de quem entra
    await expect(page.getByTestId("public-attendees")).toHaveCount(0);
    await expect(page.getByTestId("next-step")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: /mural da edição/i })).toHaveCount(0);
  });

  test("membro vê o próximo passo no topo, com o trilho da jornada", async ({ memberPage: page }) => {
    await page.goto(`/h/${NEXT}`);
    const step = page.getByTestId("next-step");
    await expect(step).toBeVisible();
    await expect(step).toHaveAttribute("data-step", "inscrever");
    await expect(step.getByRole("link", { name: /fazer inscrição/i })).toHaveAttribute("href", `/h/${NEXT}/inscricao`);
    await expect(step.locator('[aria-current="step"]')).toContainText(/inscrição/);
  });

  test("390px: teaser e página completa sem scroll horizontal", async ({ page, memberPage }) => {
    for (const p of [page, memberPage]) {
      await p.setViewportSize({ width: 390, height: 844 });
      await p.goto(`/h/${NEXT}`);
      await noHorizontalScroll(p);
    }
  });
});

test.describe("onboarding e painel", () => {
  test("membro já onboarded passa direto do /bem-vindo pro painel", async ({ memberPage: page }) => {
    await page.goto("/bem-vindo");
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: /seu próximo passo/i })).toBeVisible();
  });

  test("refazer: 3 passos com progresso, voltar, e o fim mostra o próximo passo", async ({ memberPage: page }) => {
    await page.goto("/bem-vindo?refazer=1");
    await expect(page.getByText(/passo 1 de 3/)).toBeVisible();
    await page.getByRole("button", { name: "participar de hackathon" }).click();
    await page.getByTestId("onboarding-continue").click();
    await expect(page.getByText(/passo 2 de 3/)).toBeVisible();
    await page.getByRole("button", { name: /voltar/ }).click();
    await expect(page.getByText(/passo 1 de 3/)).toBeVisible();
    await page.getByTestId("onboarding-continue").click();
    await page.getByLabel(/cidade/i).fill("Sorocaba, SP");
    await page.getByTestId("onboarding-continue").click();
    await expect(page.getByText(/passo 3 de 3/)).toBeVisible();
    await page.getByTestId("onboarding-continue").click();
    await expect(page.getByTestId("onboarding-done")).toBeVisible();
    await expect(page.getByTestId("onboarding-next")).toHaveAttribute("href", /^\/h\/[^/]+$/);
  });

  test("redirect_url volta pra inscrição da edição no fim", async ({ memberPage: page }) => {
    await page.goto(`/bem-vindo?refazer=1&redirect_url=${encodeURIComponent(`/h/${NEXT}/inscricao`)}`);
    await page.getByRole("button", { name: "pular por agora" }).click();
    await expect(page.getByTestId("onboarding-next")).toHaveAttribute("href", `/h/${NEXT}/inscricao`);
  });
});
