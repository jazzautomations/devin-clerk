import { expect, type Browser, type Page } from "@playwright/test";
import { AUTH_FILE, E2E_MEMBER_EMAIL, signInTicket, test } from "./auth";
import { openE2eDb } from "./db";
import { myMeet, optInEncounters } from "@/lib/encounters";

// Encontros na edição (spec 046, onda 5 — migration 050). Dois contextos de
// navegador, duas pessoas de verdade: A ativa os encontros e lê o código de B
// pelo QR (?c=), B confirma, e o contato aparece pros dois. Tudo em 390px sem
// scroll horizontal.

const SHOTS = process.env.E2E_SHOT_DIR;
const H = "e2e-encontros-2026";
const B_EMAIL = "e2e-encontros-b+clerk_test@example.com";

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "scroll horizontal").toBeLessThanOrEqual(0);
}
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function memberId(email: string): Promise<number | null> {
  const r = await openE2eDb().prepare("SELECT id FROM members WHERE email = ?").get<{ id: number }>(email);
  return r?.id ?? null;
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

async function cleanup() {
  const db = openE2eDb();
  const ids = [await memberId(E2E_MEMBER_EMAIL), await memberId(B_EMAIL)].filter((x): x is number => x !== null);
  await db.prepare(`DELETE FROM encounter_sides WHERE "encounterId" IN (SELECT id FROM encounters WHERE "hackathonId" = ?)`).run(H);
  await db.prepare(`DELETE FROM encounter_declines WHERE "hackathonId" = ?`).run(H);
  await db.prepare(`DELETE FROM encounters WHERE "hackathonId" = ?`).run(H);
  await db.prepare(`DELETE FROM introductions WHERE "hackathonId" = ?`).run(H);
  await db.prepare(`DELETE FROM edition_meet_codes WHERE "hackathonId" = ?`).run(H);
  await db.prepare(`DELETE FROM notifications WHERE href = ?`).run(`/h/${H}/encontros`);
  await db.prepare(`DELETE FROM checkins WHERE "registrationId" IN (SELECT id FROM registrations WHERE "hackathonId" = ?)`).run(H);
  await db.prepare(`DELETE FROM registrations WHERE "hackathonId" = ?`).run(H);
  await db.prepare(`DELETE FROM hackathons WHERE id = ?`).run(H);
  for (const id of ids) {
    await db.prepare(`DELETE FROM member_badges WHERE "memberId" = ?`).run(id);
    await db.prepare(`DELETE FROM notifications WHERE "memberId" = ?`).run(id);
    await db.prepare(`DELETE FROM members WHERE id = ? AND email = ?`).run(id, B_EMAIL);
  }
}

/** inscrição aprovada + check-in + perfil com LinkedIn (o canal padrão) */
async function seedPerson(id: number) {
  const db = openE2eDb();
  const reg = await db
    .prepare(
      `INSERT INTO registrations ("memberId", "hackathonId", status, "publicListing")
       VALUES (?, ?, 'approved', 1)
       ON CONFLICT ("memberId", "hackathonId") DO UPDATE SET status = 'approved' RETURNING id`,
    )
    .get<{ id: number }>(id, H);
  await db.prepare("INSERT OR IGNORE INTO checkins (\"registrationId\") VALUES (?)").run(reg!.id);
  await db.prepare(`UPDATE members SET linkedin = ? WHERE id = ?`).run(`https://linkedin.com/in/e2e-${id}`, id);
}

test.beforeAll(async () => {
  const db = openE2eDb();
  await cleanup();
  const startsAt = new Date(Date.now() - 2 * 3600_000).toISOString();
  const endsAt = new Date(Date.now() + 8 * 3600_000).toISOString();
  await db
    .prepare(
      `INSERT INTO hackathons (id, name, organizer, startsAt, endsAt, format, location, registrationUrl, tags, active, source, "encountersOn", "encounterMissionsOn")
       VALUES (?, 'Encontros E2E', 'HackaHub', ?, ?, 'presencial', 'Recife, PE', '', '[]', 1, 'painel', 1, 1)`,
    )
    .run(H, startsAt, endsAt);
  const a = await memberId(E2E_MEMBER_EMAIL);
  if (a) await seedPerson(a);
});

test.afterAll(async () => {
  await cleanup();
});

test("duas pessoas: código, confirmação dos dois e contato", async ({ browser, baseURL }) => {
  const db = openE2eDb();
  const aId = (await memberId(E2E_MEMBER_EMAIL))!;
  const b = await secondPerson(browser, baseURL!);
  const bId = (await memberId(B_EMAIL))!;
  await seedPerson(bId);

  // A: ativa os encontros pelo aceite (nada vem marcado)
  const aCtx = await browser.newContext({ storageState: AUTH_FILE, baseURL });
  const a = await aCtx.newPage();
  await a.setViewportSize({ width: 390, height: 844 });
  await a.goto(`/h/${H}/encontros`);
  await expect(a.getByTestId("encontros-aceite")).toBeVisible();
  await expect(a.getByTestId("encontros-ativar")).toBeVisible();
  await noHorizontalScroll(a);
  await shot(a, "encontros-aceite");
  await a.getByTestId("encontros-ativar").click();
  await expect(a.getByTestId("encontros-codigo")).toBeVisible();
  const aCode = (await a.getByTestId("encontros-codigo").innerText()).trim();
  expect(aCode).toMatch(/^[2-9A-HJ-NP-Z]{5}$/);
  await expect(a.getByTestId("encontros-qr")).toBeVisible();
  await noHorizontalScroll(a);
  await shot(a, "encontros-meu-codigo");

  // B: ativa e recebe um código próprio (seed do aceite direto no banco)
  await optInEncounters(bId, H);
  const bCode = (await myMeet(bId, H))!.code;
  await b.page.setViewportSize({ width: 390, height: 844 });
  await b.page.goto(`/h/${H}/encontros`);
  await expect(b.page.getByTestId("encontros-codigo")).toHaveText(bCode);
  await noHorizontalScroll(b.page);

  // A lê o QR de B: a URL com ?c= já registra o pedido
  await a.goto(`/h/${H}/encontros?c=${bCode}`);
  await expect(a.getByTestId("encontros-feedback")).toContainText("Pedido enviado");
  await expect(a.getByTestId("encontros-esperando")).toBeVisible();
  await shot(a, "encontros-esperando");

  // B vê o pedido e confirma
  await b.page.reload();
  await expect(b.page.getByTestId("encontros-pedidos")).toBeVisible();
  await shot(b.page, "encontros-pedido");
  await b.page.getByTestId("encontros-confirmar").click();
  await expect(b.page.getByTestId("encontros-confirmados")).toBeVisible();
  await expect(b.page.getByTestId("encontros-contato")).toContainText("linkedin.com/in/e2e-");

  // A vê o encontro confirmado e o contato de B
  await a.reload();
  await expect(a.getByTestId("encontros-confirmados")).toBeVisible();
  await expect(a.getByTestId("encontros-contato")).toContainText(`linkedin.com/in/e2e-${bId}`);
  await expect(a.getByTestId("encontros-contadores")).toContainText("1 pessoa");
  await noHorizontalScroll(a);
  await shot(a, "encontros-confirmado");

  // "como foi a conversa": um lado "além do oi" não vira profundidade
  await a.getByTestId("encontros-depth-alem").click();
  await expect(a.getByTestId("encontros-confirmados")).toContainText("Só conta quando a outra pessoa");
  await b.page.reload();
  await b.page.getByTestId("encontros-depth-rapido").click();
  await a.reload();
  await expect(a.getByTestId("encontros-contadores")).toContainText("0 além do oi");

  // "quem eu conheci" é privado e mostra o contato
  await a.goto("/perfil/conexoes");
  await expect(a.getByTestId("conexao")).toBeVisible();
  await expect(a.getByTestId("conexao-contato")).toContainText("linkedin.com/in/e2e-");
  await noHorizontalScroll(a);
  await shot(a, "encontros-conexoes");

  // o encontro aparece nos dois lados, e um segundo encontro não nasce
  const rows = await db
    .prepare(`SELECT status FROM encounters WHERE "hackathonId" = ? AND "lowId" IN (?, ?)`)
    .all<{ status: string }>(H, aId, bId);
  expect(rows).toEqual([{ status: "confirmed" }]);

  await b.close();
  await aCtx.close();
});
