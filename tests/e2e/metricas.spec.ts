import { expect, type Page } from "@playwright/test";
import { E2E_MEMBER_EMAIL, test } from "./auth";
import { openE2eDb } from "./db";

// Painel de métricas da rede (spec 046, metricas-e-checkpoint): só o admin
// global vê /admin/metricas; deslogado vai pro cadastro e membro comum leva
// 404. O membro de teste vira admin só durante o bloco do admin. Tudo em 390px.

const SHOTS = process.env.E2E_SHOT_DIR;
const BODY = "e2e-metricas: post da semana";

async function setRole(role: "admin" | "member") {
  await openE2eDb().prepare("UPDATE members SET role = ? WHERE email = ?").run(role, E2E_MEMBER_EMAIL);
}

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "scroll horizontal").toBeLessThanOrEqual(0);
}

test.describe.configure({ mode: "serial" });

test.describe("métricas da rede", () => {
  test.beforeAll(async ({ request }) => {
    await request.get("/api/health");
    await setRole("member");
  });
  test.afterAll(async () => {
    await setRole("member");
    await openE2eDb().prepare("DELETE FROM posts WHERE body = ?").run(BODY);
  });

  test("deslogado vai pro cadastro", async ({ page }) => {
    await page.goto("/admin/metricas");
    await expect(page).toHaveURL(/sign-in|sign-up|clerk/i, { timeout: 15000 });
  });

  test("membro comum leva 404", async ({ memberPage: page }) => {
    const res = await page.goto("/admin/metricas");
    expect(res?.status()).toBe(404);
    await expect(page.getByTestId("metrics-page")).toHaveCount(0);
  });

  test("admin chega pelo /admin e vê o checkpoint em 390px", async ({ memberPage: page }) => {
    await setRole("admin");
    const db = openE2eDb();
    const me = await db.prepare("SELECT id FROM members WHERE email = ?").get<{ id: number }>(E2E_MEMBER_EMAIL);
    await db.prepare("INSERT INTO posts (memberId, body) VALUES (?, ?)").run(me!.id, BODY);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin");
    await page.getByTestId("admin-metrics-link").click();
    await expect(page).toHaveURL(/\/admin\/metricas$/);

    const checkpoint = page.getByTestId("metrics-checkpoint");
    await expect(checkpoint).toContainText("checkpoint da onda 3");
    await expect(checkpoint).toContainText("A Onda 3 começa quando o fundador olhar estes números depois da próxima edição.");
    await expect(page.getByTestId("checkpoint-wau-value")).toHaveText(/^\d+$/);
    await expect(page.getByTestId("checkpoint-follow-value")).toHaveText(/^(\d+%|—)$/);
    await expect(page.getByTestId("checkpoint-depoimento")).toContainText("meta 30%");

    // posts desta semana (segunda 00:00 em Brasília até agora), contados à mão
    const manual = await db
      .prepare(
        `SELECT COUNT(*)::int AS n FROM posts
         WHERE to_ts(createdAt) >= (date_trunc('week', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')`,
      )
      .get<{ n: number }>();
    expect(manual!.n).toBeGreaterThan(0);
    const cells = page.getByTestId("metric-posts").locator("td");
    await expect(cells).toHaveCount(4);
    await expect(cells.last().locator("span").first()).toHaveText(String(manual!.n));

    // o admin acabou de entrar: conta como ativo nesta semana
    expect(Number(await page.getByTestId("checkpoint-wau-value").textContent())).toBeGreaterThan(0);

    await noHorizontalScroll(page);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/metricas-390.png`, fullPage: true });
  });
});
