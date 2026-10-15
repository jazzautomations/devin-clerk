import { expect, type Page } from "@playwright/test";
import { E2E_MEMBER_EMAIL, test } from "./auth";
import { openE2eDb } from "./db";

// Comunidades e organizar sozinho: cartão público mínimo, /comunidades
// logado, criar comunidade, abrir e publicar hackathon nela, entrar/sair e a
// landing com as comunidades reais. Tudo também em 390px.

const SHOTS = process.env.E2E_SHOT_DIR;
const SLUG = "e2e-comunidade-recife";

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "scroll horizontal").toBeLessThanOrEqual(0);
}
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function cleanup() {
  const db = openE2eDb();
  const c = await db.prepare("SELECT id FROM communities WHERE slug = ?").get<{ id: number }>(SLUG);
  if (!c) return;
  const hs = await db.prepare(`SELECT id FROM hackathons WHERE "communityId" = ?`).all<{ id: string }>(c.id);
  for (const h of hs) {
    await db.prepare(`DELETE FROM deliveries WHERE "announcementId" IN (SELECT id FROM announcements WHERE "hackathonId" = ?)`).run(h.id);
    for (const t of ["announcements", "edition_roles", "cards"]) {
      await db.prepare(`DELETE FROM ${t} WHERE "hackathonId" = ?`).run(h.id);
    }
    await db.prepare("DELETE FROM hackathons WHERE id = ?").run(h.id);
  }
  await db.prepare("DELETE FROM posts WHERE \"communityId\" = ?").run(c.id);
  await db.prepare("DELETE FROM communities WHERE id = ?").run(c.id);
}

test.describe.configure({ mode: "serial" });

test.describe("comunidade — cartão público mínimo", () => {
  test("anon vê nome, cidade, membros e o CTA que cadastra e volta; o resto é de quem entra", async ({ page }) => {
    for (const vw of [1280, 390]) {
      await page.setViewportSize({ width: vw, height: 900 });
      await page.goto("/comunidade/hack-inova");
      const card = page.getByTestId("public-card");
      await expect(card).toBeVisible();
      await expect(card.getByRole("heading", { level: 1, name: "Hack Inova" })).toBeVisible();
      await expect(card).toContainText("São Paulo, SP");
      await expect(card).toContainText("verificada pelo HackaHub");
      await expect(page.getByTestId("public-card-cta")).toHaveText(/entrar na comunidade/);
      await expect(page.getByTestId("public-card-cta")).toHaveAttribute("href", `/sign-up?redirect_url=${encodeURIComponent("/comunidade/hack-inova")}`);
      await expect(page.getByTestId("community-members")).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "Mural" })).toHaveCount(0);
      await noHorizontalScroll(page);
      await shot(page, `comunidade-publica-${vw === 390 ? "390" : "desktop"}`);
    }
  });

  test("comunidade que não existe é 404", async ({ request }) => {
    expect((await request.get("/comunidade/nao-existe-mesmo")).status()).toBe(404);
  });
});

test.describe("comunidades — logado", () => {
  test.beforeAll(cleanup);
  test.afterAll(cleanup);

  test("/comunidades lista, busca e cabe em 390px", async ({ memberPage: page }) => {
    for (const vw of [1280, 390]) {
      await page.setViewportSize({ width: vw, height: 900 });
      await page.goto("/comunidades");
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByTestId("community-row").filter({ hasText: "Hack Inova" })).toBeVisible();
      await expect(page.getByTestId("comunidades-criar")).toHaveAttribute("href", "/comunidades/nova");
      await noHorizontalScroll(page);
      await shot(page, `comunidades-${vw === 390 ? "390" : "desktop"}`);
    }
    await page.goto("/comunidades?q=zzz-nada");
    await expect(page.getByTestId("comunidades-vazio")).toBeVisible();
  });

  test("entrar e sair da Hack Inova", async ({ memberPage: page }) => {
    await page.goto("/comunidade/hack-inova");
    await expect(page.getByTestId("community-page")).toBeVisible();
    await page.getByTestId("community-join").click();
    await expect(page.getByTestId("community-leave")).toBeVisible();
    await expect(page.getByTestId("community-members")).toContainText(/Membro/);
    page.once("dialog", (d) => d.accept());
    await page.getByTestId("community-leave").click();
    await expect(page.getByTestId("community-join")).toBeVisible();
  });

  test("cria a comunidade, abre o hackathon nela e publica sem o admin", async ({ memberPage: page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/comunidades/nova");
    await noHorizontalScroll(page);
    await page.getByPlaceholder("Hack Club Sorocaba").fill("E2E Comunidade Recife");
    await expect(page.locator('input[pattern]')).toHaveValue(SLUG);
    await page.getByPlaceholder("Sorocaba, SP").fill("Recife, PE");
    await page.getByPlaceholder("Hackathons de fim de semana", { exact: false }).fill("Gente de Recife que constrói no fim de semana.");
    await shot(page, "criar-comunidade-390");
    await page.getByTestId("community-submit").click();
    await expect(page).toHaveURL(new RegExp(`/comunidade/${SLUG}\\?criada=1$`));
    await expect(page.getByTestId("community-created")).toBeVisible();
    await noHorizontalScroll(page);
    const db = openE2eDb();
    const row = await db
      .prepare(
        `SELECT c.city, cm.role FROM communities c JOIN community_members cm ON cm."communityId" = c.id
         JOIN members m ON m.id = cm."memberId" WHERE c.slug = ? AND m.email = ?`,
      )
      .get(SLUG, E2E_MEMBER_EMAIL);
    expect(row).toEqual({ city: "Recife, PE", role: "dono" });

    await page.getByTestId("community-new-hackathon").click();
    await expect(page).toHaveURL(new RegExp(`/comunidade/${SLUG}/hackathon/novo$`));
    await noHorizontalScroll(page);
    await page.getByPlaceholder("Hackathon de Sorocaba 2027").fill("E2E Hack Recife");
    await page.locator('input[name="startsAt"]').fill("2027-06-12T09:00");
    await page.locator('input[name="endsAt"]').fill("2027-06-13T18:00");
    await page.locator('input[name="location"]').fill("Porto Digital, Recife, PE");
    await page.locator('input[name="capacity"]').fill("60");
    await shot(page, "criar-hackathon-390");
    await page.getByTestId("community-hackathon-submit").click();
    await expect(page).toHaveURL(/\/admin\/h\/e2e-hack-recife-2027\?novo=1$/);
    await expect(page.getByTestId("ov-novo")).toContainText("E2E Comunidade Recife");
    await noHorizontalScroll(page);
    await shot(page, "painel-rascunho-390");
    const h = await db
      .prepare(`SELECT active, source, capacity FROM hackathons WHERE id = 'e2e-hack-recife-2027'`)
      .get();
    expect(h).toEqual({ active: 0, source: "painel", capacity: 60 });

    await page.getByTestId("ov-status").getByRole("button", { name: "publicar edição" }).click();
    await expect(page.getByTestId("ov-phase")).toHaveText(/inscrições abertas/);
    expect(await db.prepare(`SELECT active FROM hackathons WHERE id = 'e2e-hack-recife-2027'`).get()).toEqual({ active: 1 });
    // o dono está na comunidade: recebe o aviso do hackathon novo
    const note = await db
      .prepare(
        `SELECT n.text FROM notifications n JOIN members m ON m.id = n."memberId"
         WHERE n.type = 'edicao_nova' AND n.href = '/h/e2e-hack-recife-2027' AND m.email = ?`,
      )
      .get<{ text: string }>(E2E_MEMBER_EMAIL);
    expect(note?.text).toContain("E2E Comunidade Recife");

    await page.goto(`/comunidade/${SLUG}`);
    await expect(page.getByTestId("community-upcoming")).toContainText("E2E Hack Recife");
    await page.setViewportSize({ width: 1280, height: 900 });
    await shot(page, "comunidade-logada-desktop");
    await page.setViewportSize({ width: 390, height: 900 });
    await noHorizontalScroll(page);
    await shot(page, "comunidade-logada-390");

    // a página do hackathon leva pra comunidade
    await page.goto("/h/e2e-hack-recife-2027");
    await expect(page.getByTestId("edition-community-link")).toHaveAttribute("href", `/comunidade/${SLUG}`);
  });

  test("painel mostra suas comunidades com o próximo passo", async ({ memberPage: page }) => {
    await page.goto("/dashboard");
    const box = page.getByTestId("dashboard-communities");
    await expect(box).toContainText("E2E Comunidade Recife");
    await expect(box.getByRole("link", { name: /abrir o painel da edição/ })).toHaveAttribute("href", "/admin/h/e2e-hack-recife-2027");
    await page.setViewportSize({ width: 390, height: 900 });
    await noHorizontalScroll(page);
    await shot(page, "painel-390");
    await page.setViewportSize({ width: 1280, height: 900 });
    await shot(page, "painel-desktop");
  });
});

test.describe("telas novas sem conta mandam pro cadastro", () => {
  for (const p of ["/comunidades", "/comunidades/nova", "/comunidade/hack-inova/editar", "/comunidade/hack-inova/hackathon/novo"]) {
    test(`${p} → cadastro`, async ({ request }) => {
      const res = await request.get(p, { maxRedirects: 0 });
      expect(res.status()).toBe(307);
      expect(res.headers()["location"]).toContain(`/sign-up?redirect_url=${encodeURIComponent(p)}`);
    });
  }
  test("membro comum não abre editar nem novo hackathon de comunidade dos outros (404)", async ({ memberPage: page }) => {
    for (const p of ["/comunidade/hack-inova/editar", "/comunidade/hack-inova/hackathon/novo"]) {
      const res = await page.goto(p);
      expect(res?.status(), p).toBe(404);
    }
  });
});
