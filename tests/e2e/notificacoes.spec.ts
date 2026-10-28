import { createHmac } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { E2E_MEMBER_EMAIL, test } from "./auth";
import { openE2eDb } from "./db";

// Notificações boas (migration 040): lista agrupada com abas e "mais",
// abrir marca o grupo inteiro, preferências por grupo que valem no notify,
// link assinado de parar o resumo semanal e as guardas sem login. Tudo
// também em 390px.

const SHOTS = process.env.E2E_SHOT_DIR;
const PEOPLE = ["e2e_nb_a", "e2e_nb_b", "e2e_nb_c", "e2e_nb_d", "e2e_nb_e"];
const HREF = "/feed#e2e-nb";

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "scroll horizontal").toBeLessThanOrEqual(0);
}
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}
// o mesmo token de lib/digest.ts (digestToken), com o segredo que o
// playwright.config passa pro server
function digestToken(memberId: number): string {
  const mac = createHmac("sha256", process.env.HACKAHUB_TICKET_SECRET!).update(`${memberId}:digest`).digest("base64url");
  return `D1.${memberId}.${mac}`;
}

async function me() {
  const r = await openE2eDb().prepare("SELECT id FROM members WHERE email = ?").get<{ id: number }>(E2E_MEMBER_EMAIL);
  return r!.id;
}

async function cleanup() {
  const db = openE2eDb();
  const meId = await me();
  await db.prepare(`DELETE FROM notification_prefs WHERE "memberId" = ?`).run(meId);
  await db.prepare(`DELETE FROM digest_sends WHERE "memberId" = ?`).run(meId);
  await db.prepare(`DELETE FROM notifications WHERE "memberId" = ? AND (href = ? OR type IN ('e2e_nb', 'mention'))`).run(meId, HREF);
  await db.prepare(`DELETE FROM notifications WHERE "actorId" IN (SELECT id FROM members WHERE username = ANY(?::text[]))`).run(`{${PEOPLE.join(",")}}`);
  await db.prepare(`DELETE FROM members WHERE username = ANY(?::text[])`).run(`{${PEOPLE.join(",")}}`);
}

async function seed() {
  const db = openE2eDb();
  const meId = await me();
  // um aviso essencial mais antigo e cinco reações no mesmo post
  await db
    .prepare(`INSERT INTO notifications ("memberId", type, text, href) VALUES (?, 'e2e_nb', 'Sua inscrição no E2E Notificações foi aprovada.', '/radar')`)
    .run(meId);
  for (const u of PEOPLE) {
    const p = await db
      .prepare(`INSERT INTO members ("clerkId", username, email, name) VALUES (?, ?, ?, ?) RETURNING id`)
      .get<{ id: number }>(`clerk_${u}`, u, `${u}@t.dev`, `Pessoa ${u.slice(-1).toUpperCase()}`);
    await db
      .prepare(`INSERT INTO notifications ("memberId", "actorId", "actorUsername", type, text, href) VALUES (?, ?, ?, 'reaction', ?, ?)`)
      .run(meId, p!.id, u, `@${u} reagiu ao seu post`, HREF);
  }
}

test.describe.configure({ mode: "serial" });

test.describe("notificações boas", () => {
  test.beforeAll(async () => {
    await cleanup();
    await seed();
  });
  test.afterAll(cleanup);

  test("anon: preferências e cron dão 401, página manda pro login", async ({ page, request }) => {
    expect((await request.get("/api/notifications/preferencias")).status()).toBe(401);
    expect((await request.patch("/api/notifications/preferencias", { data: { group: "social", inApp: false } })).status()).toBe(401);
    expect((await request.post("/api/cron/digest")).status()).toBe(401);
    await page.goto("/notificacoes/preferencias");
    await expect(page).toHaveURL(/sign-in|sign-up/);
  });

  test("5 reações viram uma linha; abrir marca o grupo e leva ao post", async ({ memberPage: page }) => {
    for (const vw of [1280, 390]) {
      await page.setViewportSize({ width: vw, height: 900 });
      await page.goto("/notificacoes");
      const rows = page.getByTestId("notification-row");
      const group = rows.filter({ hasText: "e mais 3 reagiram ao seu post" });
      await expect(group).toHaveCount(1);
      await expect(group).toHaveAttribute("data-total", "5");
      await expect(group).toContainText("@e2e_nb_e, @e2e_nb_d e mais 3 reagiram ao seu post");
      await expect(rows.filter({ hasText: "E2E Notificações foi aprovada" })).toHaveCount(1);
      await noHorizontalScroll(page);
      await shot(page, `notificacoes-${vw === 390 ? "390" : "desktop"}`);
    }
    // o sino mostra a mesma linha agrupada
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole("button", { name: /notificações/ }).first().click();
    // no dropdown o link vai direto pro destino (a lista da página usa o /open)
    await expect(page.locator(`a[href="${HREF}"]`).filter({ hasText: "e mais 3 reagiram ao seu post" })).toBeVisible();
    await page.keyboard.press("Escape");

    await page.goto("/notificacoes");
    await page.getByTestId("notification-row").filter({ hasText: "e mais 3 reagiram" }).click();
    await expect(page).toHaveURL(/\/feed#e2e-nb$/);
    const left = await openE2eDb()
      .prepare(`SELECT COUNT(*)::int AS n FROM notifications WHERE "memberId" = ? AND href = ? AND read = 0`)
      .get<{ n: number }>(await me(), HREF);
    expect(Number(left?.n)).toBe(0);
  });

  test("seguidores novos viram uma linha que leva à lista de seguidores", async ({ memberPage: page }) => {
    const db = openE2eDb();
    const meId = await me();
    // seguidor de outro spec não entra na conta deste
    await db.prepare(`UPDATE notifications SET read = 1 WHERE "memberId" = ? AND type = 'follow'`).run(meId);
    // o href de cada uma é o perfil de quem seguiu, como em notifyNewFollower
    for (const u of PEOPLE.slice(0, 4)) {
      await db
        .prepare(
          `INSERT INTO notifications ("memberId", "actorId", "actorUsername", type, text, href)
           SELECT ?, id, username, 'follow', ?, ? FROM members WHERE username = ?`,
        )
        .run(meId, `@${u} começou a seguir você`, `/u/${u}`, u);
    }
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/notificacoes");
    const group = page.getByTestId("notification-row").filter({ hasText: "começaram a seguir você" });
    await expect(group).toHaveCount(1);
    await expect(group).toHaveAttribute("data-total", "4");
    await expect(group).toContainText("@e2e_nb_d, @e2e_nb_c e mais 2 começaram a seguir você");
    await noHorizontalScroll(page);
    await group.click();
    await expect(page).toHaveURL(/\/perfil\/seguidores$/);
    const left = await db
      .prepare(`SELECT COUNT(*)::int AS n FROM notifications WHERE "memberId" = ? AND type = 'follow' AND read = 0`)
      .get<{ n: number }>(meId);
    expect(Number(left?.n)).toBe(0);
  });

  test("aba menções: vazia com texto, depois mostra a menção", async ({ memberPage: page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/notificacoes?aba=mencoes");
    await expect(page.getByRole("link", { name: "menções" })).toHaveAttribute("aria-current", "page");
    const empty = page.getByTestId("notifications-empty");
    // o membro e2e pode ter menção de outro spec; sem nenhuma, o vazio fala o que aparece aqui
    if (await empty.count()) await expect(empty).toContainText("Ninguém mencionou você ainda");
    await openE2eDb()
      .prepare(`INSERT INTO notifications ("memberId", type, text, href) VALUES (?, 'mention', '@e2e_nb_a mencionou você', ?)`)
      .run(await me(), HREF);
    await page.reload();
    await expect(page.getByTestId("notification-row").first()).toContainText("mencionou você");
    await expect(page.getByTestId("notification-row").filter({ hasText: "reagiram" })).toHaveCount(0);
    await noHorizontalScroll(page);
  });

  test("preferências: desliga social, vale no banco e no reload; essencial travado", async ({ memberPage: page }) => {
    for (const vw of [1280, 390]) {
      await page.setViewportSize({ width: vw, height: 900 });
      await page.goto("/notificacoes");
      await page.getByTestId("prefs-link").click();
      await expect(page).toHaveURL(/\/notificacoes\/preferencias$/);
      await expect(page.getByRole("heading", { name: "O que chega pra você" })).toBeVisible();
      const essencial = page.getByTestId("pref-essencial");
      await expect(essencial).toBeDisabled();
      await expect(essencial).toHaveAttribute("aria-checked", "true");
      await expect(page.getByTestId("pref-row-essencial")).toContainText("Avisos da sua inscrição sempre chegam");
      await noHorizontalScroll(page);
      await shot(page, `preferencias-${vw === 390 ? "390" : "desktop"}`);
    }
    const social = page.getByTestId("pref-social");
    await expect(social).toHaveAttribute("aria-checked", "true");
    const saved = page.waitForResponse((r) => r.url().includes("/api/notifications/preferencias") && r.request().method() === "PATCH");
    await social.click();
    expect((await saved).status()).toBe(200);
    await expect(social).toHaveAttribute("aria-checked", "false");
    await page.reload();
    await expect(page.getByTestId("pref-social")).toHaveAttribute("aria-checked", "false");
    await expect(page.getByTestId("pref-comunidade")).toHaveAttribute("aria-checked", "true");
    const row = await openE2eDb()
      .prepare(`SELECT "inApp" FROM notification_prefs WHERE "memberId" = ? AND "group" = 'social'`)
      .get<{ inApp: number }>(await me());
    expect(row?.inApp).toBe(0);

    // o resumo também desliga e religa
    const digest = page.getByTestId("pref-digest");
    await expect(digest).toHaveAttribute("aria-checked", "true");
    await digest.click();
    await expect(digest).toHaveAttribute("aria-checked", "false");
    await digest.click();
    await expect(digest).toHaveAttribute("aria-checked", "true");
    // volta o social pro padrão
    await page.getByTestId("pref-social").click();
    await expect(page.getByTestId("pref-social")).toHaveAttribute("aria-checked", "true");
  });

  test("link do e-mail: token inválido 404, confirmar desliga o resumo", async ({ page, request }) => {
    expect((await request.get("/api/notifications/digest/sair/lixo")).status()).toBe(404);
    const meId = await me();
    const forged = digestToken(meId).replace(`D1.${meId}.`, `D1.${meId + 1}.`);
    expect((await request.post(`/api/notifications/digest/sair/${forged}`)).status()).toBe(404);

    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto(`/api/notifications/digest/sair/${digestToken(meId)}`);
    await expect(page.getByRole("heading", { name: "Parar o resumo semanal" })).toBeVisible();
    // abrir o link sozinho não desliga
    const before = await openE2eDb()
      .prepare(`SELECT email FROM notification_prefs WHERE "memberId" = ? AND "group" = 'digest'`)
      .get<{ email: number }>(meId);
    expect(before?.email ?? 1).toBe(1);
    await noHorizontalScroll(page);
    await page.getByRole("button", { name: "parar de receber" }).click();
    await expect(page.getByRole("heading", { name: "Pronto, o resumo parou" })).toBeVisible();
    const after = await openE2eDb()
      .prepare(`SELECT email FROM notification_prefs WHERE "memberId" = ? AND "group" = 'digest'`)
      .get<{ email: number }>(meId);
    expect(after?.email).toBe(0);
  });

  test("cancelar num clique do Gmail: POST anônimo com o corpo da RFC 8058 desliga", async ({ request }) => {
    const meId = await me();
    const db = openE2eDb();
    await db.prepare(`UPDATE notification_prefs SET email = 1 WHERE "memberId" = ? AND "group" = 'digest'`).run(meId);
    const res = await request.post(`/api/notifications/digest/sair/${digestToken(meId)}`, {
      form: { "List-Unsubscribe": "One-Click" },
    });
    expect(res.status()).toBe(200);
    const row = await db
      .prepare(`SELECT email FROM notification_prefs WHERE "memberId" = ? AND "group" = 'digest'`)
      .get<{ email: number }>(meId);
    expect(row?.email).toBe(0);
  });
});
