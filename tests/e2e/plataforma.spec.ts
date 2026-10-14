import { expect } from "@playwright/test";
import { test } from "./auth";

// Pacote A da auditoria (spec 041): erro com tela própria, id fora do
// INTEGER vira 404, health com versão e ícones.

const SHOTS = process.env.E2E_SHOTS_DIR;

test.describe("plataforma — erro, ids e arquivos que o navegador pede", () => {
  test("arquivo inexistente nunca mostra a tela de erro em inglês", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const res = await page.goto("/x.png");
    const status = res?.status() ?? 0;
    const body = await page.locator("body").innerText();
    expect(body).not.toContain("This page couldn't load");
    expect(body).not.toMatch(/Reload to try again/);
    // ou 404, ou a tela de erro em PT-BR com o código de referência
    if (status !== 404) {
      await expect(page.getByTestId("error-screen")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Algo quebrou do nosso lado" })).toBeVisible();
      await expect(page.getByRole("button", { name: "tentar de novo" })).toBeVisible();
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/erro-x-png-390.png`, fullPage: true });
  });

  test("id de projeto acima do INTEGER do Postgres responde 404, não 500", async ({ request }) => {
    for (const raw of ["2147483648", "999999999999999999999", "1e21", "01"]) {
      const res = await request.get(`/p/${raw}`);
      expect(res.status(), raw).toBe(404);
    }
    const og = await request.get("/p/2147483648/opengraph-image");
    expect(og.status()).toBeLessThan(500);
  });

  test("/api/health mostra a versão; ?deep=1 traz backup, fila e disco", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.status()).toBe(200);
    const j = await res.json();
    expect(j.ok).toBe(true);
    expect(typeof j.version).toBe("string");
    const deep = await (await request.get("/api/health?deep=1")).json();
    expect(deep).toHaveProperty("backupAgeH");
    expect(deep).toHaveProperty("oldestQueuedDeliveryMin");
    expect(typeof deep.diskPct).toBe("number");
  });

  test("ícone, ícone da Apple e manifest respondem", async ({ request }) => {
    for (const path of ["/icon.png", "/apple-icon.png"]) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(200);
      expect(res.headers()["content-type"]).toContain("image/png");
    }
    const manifest = await request.get("/manifest.webmanifest");
    expect(manifest.status()).toBe(200);
    expect((await manifest.json()).lang).toBe("pt-BR");
    // /.well-known/security.txt: o conteúdo está no vitest (security-txt);
    // aqui fora ele depende da linha na allowlist do lib/access.ts, que é
    // de outro pacote
  });

  test("imagem de compartilhamento sai com cache", async ({ request }) => {
    const res = await request.get("/opengraph-image");
    expect(res.status()).toBe(200);
    expect(res.headers()["cache-control"]).toContain("max-age=3600");
  });

  test("CSP em modo relatório em toda página", async ({ request }) => {
    const res = await request.get("/");
    expect(res.headers()["content-security-policy-report-only"]).toContain("frame-ancestors 'none'");
  });
});

test.describe("ficha do projeto a 390px", () => {
  test("links vazios com texto novo, volta com área de toque e sem scroll lateral", async ({ memberPage: page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/h/hack-inova-unifacens-2026");
    const href = await page.locator('a[href^="/p/"]').first().getAttribute("href");
    await page.goto(href!);
    const back = page.getByRole("link", { name: "← voltar pro arquivo da edição" });
    await expect(back).toBeVisible();
    const box = await back.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(40);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/projeto-390.png`, fullPage: true });
  });
});
