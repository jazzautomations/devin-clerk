import { expect, type Browser, type Page } from "@playwright/test";
import { AUTH_FILE, E2E_MEMBER_EMAIL, signInTicket, test } from "./auth";
import { openE2eDb } from "./db";

// Mensagem direta com trava (migration 056). Dois contextos, duas pessoas
// sem laço: A pede conversa no /u de B, B aceita na caixa de pedidos, a
// conversa abre e as mensagens fluem pros dois lados. Tudo em 390px sem
// scroll horizontal.

const SHOTS = process.env.E2E_SHOT_DIR;
const B_EMAIL = "e2e-dm-b+clerk_test@example.com";

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "scroll horizontal").toBeLessThanOrEqual(0);
}
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}
async function memberOf(email: string): Promise<{ id: number; username: string } | null> {
  return (await openE2eDb().prepare("SELECT id, username FROM members WHERE email = ?").get<{ id: number; username: string }>(email)) ?? null;
}

/** segunda pessoa: usuário de teste do Clerk, onboarding fechado, sessão própria */
async function secondPerson(browser: Browser, baseURL: string): Promise<{ page: Page; close: () => Promise<void> }> {
  const ctx = await browser.newContext({ baseURL });
  const page = await ctx.newPage();
  await page.goto(`/sign-in?__clerk_ticket=${await signInTicket(B_EMAIL)}`, { waitUntil: "networkidle" });
  await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 60_000 });
  await page.goto("/dashboard");
  await page.waitForURL(/\/(bem-vindo|dashboard)/, { timeout: 30_000 });
  if (page.url().includes("/bem-vindo")) {
    await page.getByTestId("onboarding-continue").waitFor();
    const res = await page.request.patch("/api/onboarding", { data: { finish: true } });
    if (!res.ok()) throw new Error(`onboarding da segunda pessoa falhou: ${res.status()}`);
    await page.goto("/dashboard");
    await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
  }
  return { page, close: () => ctx.close() };
}

/** os dois voltam a ser desconhecidos: sem laço, sem conversa, sem bloqueio */
async function cleanup() {
  const db = openE2eDb();
  const a = await memberOf(E2E_MEMBER_EMAIL);
  const b = await memberOf(B_EMAIL);
  for (const m of [a, b]) {
    if (!m) continue;
    await db.prepare(`DELETE FROM dm_threads WHERE "memberId" = ? OR "peerId" = ?`).run(m.id, m.id);
    await db.prepare(`DELETE FROM notifications WHERE type = 'dm' AND ("memberId" = ? OR "actorId" = ?)`).run(m.id, m.id);
    await db.prepare(`DELETE FROM reports WHERE "targetType" = 'dm' AND ("reporterId" = ? OR "targetMemberId" = ?)`).run(m.id, m.id);
  }
  if (a && b) {
    await db
      .prepare(`DELETE FROM member_follows WHERE ("memberId" = ? AND "followedId" = ?) OR ("memberId" = ? AND "followedId" = ?)`)
      .run(a.id, b.id, b.id, a.id);
    await db
      .prepare(`DELETE FROM member_blocks WHERE ("memberId" = ? AND "blockedId" = ?) OR ("memberId" = ? AND "blockedId" = ?)`)
      .run(a.id, b.id, b.id, a.id);
  }
  if (b) await db.prepare("DELETE FROM members WHERE id = ? AND email = ?").run(b.id, B_EMAIL);
}

test.beforeAll(cleanup);
test.afterAll(cleanup);

test("desconhecido pede conversa, o outro aceita e a conversa abre", async ({ browser, baseURL }) => {
  const b = await secondPerson(browser, baseURL!);
  const bUser = (await memberOf(B_EMAIL))!;
  const aUser = (await memberOf(E2E_MEMBER_EMAIL))!;

  const aCtx = await browser.newContext({ storageState: AUTH_FILE, baseURL });
  const a = await aCtx.newPage();
  await a.setViewportSize({ width: 390, height: 844 });
  await b.page.setViewportSize({ width: 390, height: 844 });

  // A: estranhos — o /u oferece "pedir conversa", não "mensagem"
  await a.goto(`/u/${bUser.username}`);
  await expect(a.getByTestId("dm-ask")).toBeVisible();
  await expect(a.getByTestId("dm-write")).toHaveCount(0);
  await noHorizontalScroll(a);
  await a.getByTestId("dm-ask").click();
  await a.getByTestId("dm-first").fill("Vi seu projeto no radar — o diário das 4 semanas ficou ótimo. Bora trocar?");
  await shot(a, "dm-pedido");
  await a.getByTestId("dm-first-send").click();
  await expect(a.getByTestId("dm-sent")).toBeVisible();
  await aCtx.close();

  // B: a caixa tem o pedido, aceitar abre a conversa
  await b.page.goto("/mensagens");
  await expect(b.page.getByTestId("dm-requests")).toBeVisible();
  await expect(b.page.getByTestId(`dm-thread-${aUser.username}`)).toContainText("quer conversar com você");
  await noHorizontalScroll(b.page);
  await b.page.getByTestId(`dm-thread-${aUser.username}`).click();
  await expect(b.page.getByTestId("dm-pedido")).toBeVisible();
  await expect(b.page.getByTestId("dm-msg-peer")).toContainText("Bora trocar?");
  await shot(b.page, "dm-aceite");
  await b.page.getByTestId("dm-accept").click();
  await expect(b.page.getByTestId("dm-input")).toBeVisible();

  // B responde; A vê a conversa aberta e a mensagem
  await b.page.getByTestId("dm-input").fill("Opa, valeu! O diário saiu no sprint 2.");
  await b.page.getByTestId("dm-send").click();
  await expect(b.page.getByTestId("dm-msg-mine").last()).toContainText("Opa, valeu!");
  await noHorizontalScroll(b.page);
  await shot(b.page, "dm-conversa-b");

  const aCtx2 = await browser.newContext({ storageState: AUTH_FILE, baseURL });
  const a2 = await aCtx2.newPage();
  await a2.setViewportSize({ width: 390, height: 844 });
  await a2.goto("/mensagens");
  await expect(a2.getByTestId(`dm-thread-${bUser.username}`)).toBeVisible();
  await a2.getByTestId(`dm-thread-${bUser.username}`).click();
  await expect(a2.getByTestId("dm-msg-peer")).toContainText("Opa, valeu!");
  await a2.getByTestId("dm-input").fill("Fechado então. Te vejo na próxima edição.");
  await a2.getByTestId("dm-send").click();
  await expect(a2.getByTestId("dm-msg-mine").last()).toContainText("Fechado então");
  await noHorizontalScroll(a2);
  await shot(a2, "dm-conversa-a");

  // B recarrega e lê a resposta de A
  await b.page.reload();
  await expect(b.page.getByTestId("dm-msg-peer").last()).toContainText("Fechado então");
  await b.close();
  await aCtx2.close();
});
