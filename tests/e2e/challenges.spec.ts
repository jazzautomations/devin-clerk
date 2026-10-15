import { expect } from "@playwright/test";
import { test } from "./auth";
import { seedArquivoE2E } from "./db";

// BDD dos desafios patrocinados — spec 006. O sponsor na página pública
// É o inventário que se vende; participante nunca paga.

test.describe("desafios patrocinados — inventário de monetização", () => {
  test("edição com desafio mostra a marca e o prêmio em destaque", async ({
    memberPage: page,
  }) => {
    await seedArquivoE2E();
    await page.goto("/h/hack-inova-puc-saude-2026");
    await expect(page.getByText(/desafios patrocinados/i)).toBeVisible();
    // marca do sponsor proeminente — é o que se vende
    await expect(
      page.getByText("Marca Teste", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /desafio e2e só texto/i }),
    ).toBeVisible();
    await expect(page.getByText(/prêmio de teste/i)).toBeVisible();
  });

  test("edição sem desafio NÃO mostra a seção (inventário vazio não renderiza)", async ({
    memberPage: page,
  }) => {
    await page.goto("/h/hack-inova-alphaville-2026");
    await expect(page.getByText(/desafios patrocinados/i)).not.toBeVisible();
  });

  test("APIs de desafio trancadas sem login → 401 JSON", async ({ request }) => {
    const post = await request.post(
      "/api/admin/hackathons/hack-inova-puc-saude-2026/challenges",
      { data: { sponsor: "X", title: "Y" } },
    );
    expect(post.status()).toBe(401);
    expect(post.headers()["content-type"]).toContain("application/json");
    const patch = await request.fetch(
      "/api/admin/challenges/seed-puc-jornada-paciente",
      { method: "PATCH", data: { active: false } },
    );
    expect(patch.status()).toBe(401);
  });
});
