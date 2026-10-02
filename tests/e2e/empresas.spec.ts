import { expect, test } from "@playwright/test";
import { openE2eDb } from "./db";

// BDD da porta comercial — spec 022. /empresas, /legal/* e POST /api/leads são
// públicos (a venda não exige login), então tudo é testável sem Clerk.
// A seção // leads do /admin fica coberta pelo guard de auth existente.
// spec 031: /api/leads limita 5/h por IP — cada request abaixo usa um xff
// único pra não esgotar o bucket 'anon' (o dev server é compartilhado entre
// specs/runs); o comportamento de volume mora em rate-limit.spec.ts.

const rand = () => Math.floor(Math.random() * 254) + 1;
const xff = () => ({
  "x-forwarded-for": `10.${rand()}.${rand()}.${rand()}`,
});

const leadCount = (email: string) => {
  const db = openE2eDb();
  db.pragma("busy_timeout = 5000");
  const n = (
    db.prepare("SELECT COUNT(*) n FROM leads WHERE email = ?").get(email) as
      | { n: number }
      | undefined
  )?.n;
  db.close();
  return n ?? 0;
};

test.describe("/empresas — pitch pra marca", () => {
  test("renderiza hero, oferta, stats reais e formulário de lead", async ({
    page,
  }) => {
    const res = await page.goto("/empresas");
    expect(res?.status()).toBe(200);
    await expect(
      page.getByRole("heading", {
        name: /sua marca na frente de quem constrói/i,
      }),
    ).toBeVisible();
    // oferta: desafio patrocinado (com exemplos reais), arquivo/radar, talento
    await expect(page.getByText(/desafio patrocinado/i).first()).toBeVisible();
    await expect(page.getByText(/oracle/i).first()).toBeVisible();
    await expect(page.getByText(/r\$\s?5/i).first()).toBeVisible();
    await expect(
      page.locator("main").getByRole("link", { name: /talento/i }),
    ).toBeVisible();
    // prova social vinda do banco (header também tem link "membros" — scopa no main)
    await expect(
      page.locator("main").getByText("membros", { exact: true }),
    ).toBeVisible();
    // formulário de lead com os campos do spec
    await expect(page.getByLabel(/empresa/i)).toBeVisible();
    await expect(page.getByLabel(/e-mail/i)).toBeVisible();
    await expect(page.getByLabel(/interesse/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /quero conversar|enviar/i }),
    ).toBeVisible();
    // links legais no fim da página comercial
    await expect(
      page.getByRole("link", { name: /privacidade/i }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /termos/i })).toBeVisible();
  });

  test("form envia lead e confirma sem recarregar", async ({ page }) => {
    const email = `e2e-${Date.now()}@empresa.dev`;
    // injeta um IP único no POST do browser pra não contar no bucket 'anon'
    await page.route("**/api/leads", (route) =>
      route.continue({
        headers: { ...route.request().headers(), ...xff() },
      }),
    );
    await page.goto("/empresas");
    await page.getByLabel(/empresa/i).fill("Empresa E2E");
    await page.getByLabel(/e-mail/i).fill(email);
    await page
      .getByRole("button", { name: /quero conversar|enviar/i })
      .click();
    // estado done do form — "// recebido" só existe após o POST 201
    await expect(page.getByText(/recebido/i)).toBeVisible({
      timeout: 10000,
    });
    expect(leadCount(email)).toBe(1);
  });

  test("landing aponta a linha comercial pra /empresas", async ({ page }) => {
    await page.goto("/");
    await expect(
      page.getByRole("link", { name: /marca.*desafio|desafio patrocinado/i }),
    ).toHaveAttribute("href", "/empresas");
  });
});

test.describe("POST /api/leads — porta pública", () => {
  test("lead válido → 201; inválido → 400", async ({ request }) => {
    const ok = await request.post("/api/leads", {
      headers: xff(),
      data: {
        company: "Empresa Request",
        email: `req-${Date.now()}@empresa.dev`,
        interest: "edicao",
      },
    });
    expect(ok.status()).toBe(201);
    const bad = await request.post("/api/leads", {
      headers: xff(),
      data: { company: "", email: "x@y.dev", interest: "talento" },
    });
    expect(bad.status()).toBe(400);
  });

  test("honeypot preenchido → 201 sem gravar; retry → 200 sem duplicar", async ({
    request,
  }) => {
    const botEmail = `bot-${Date.now()}@farm.dev`;
    const bot = await request.post("/api/leads", {
      headers: xff(),
      data: {
        company: "Bot Co",
        email: botEmail,
        interest: "outro",
        website: "https://spam.dev",
      },
    });
    expect(bot.status()).toBe(201);
    expect(leadCount(botEmail)).toBe(0);

    const email = `dup-${Date.now()}@empresa.dev`;
    const body = { company: "Dup Co", email, interest: "outro" };
    expect(
      (await request.post("/api/leads", { headers: xff(), data: body })).status(),
    ).toBe(201);
    expect(
      (await request.post("/api/leads", { headers: xff(), data: body })).status(),
    ).toBe(200);
    expect(leadCount(email)).toBe(1);
  });
});

test.describe("legal — LGPD básica", () => {
  test("/legal/termos e /legal/privacidade abrem com heading e texto real", async ({
    page,
  }) => {
    for (const [path, heading, snippet] of [
      ["/legal/termos", /termos de uso/i, /conteúdo|conduta/i],
      ["/legal/privacidade", /privacidade/i, /perfil público|e-mail/i],
    ] as const) {
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
      await expect(page.getByText(snippet).first()).toBeVisible();
    }
  });

  test("sitemap.xml inclui /empresas e as páginas legais", async ({
    request,
  }) => {
    const res = await request.get("/sitemap.xml");
    expect(res.status()).toBe(200);
    const xml = await res.text();
    expect(xml).toContain("/empresas");
    expect(xml).toContain("/legal/termos");
    expect(xml).toContain("/legal/privacidade");
  });
});
