import { expect, type Page } from "@playwright/test";
import { E2E_MEMBER_EMAIL, test } from "./auth";
import { openE2eDb } from "./db";

// Repost e citação (spec 046, onda 4, migration 049). O botão compartilhar é
// toggle (o contador anda e volta), citar abre a caixa e leva pro /post da
// citação com o original embaixo, a timeline de quem segue mostra o repost com
// o cabeçalho de quem compartilhou, e o autor liga e desliga a citação no menu
// do post. Tudo em 390px sem scroll horizontal.

const SHOTS = process.env.E2E_SHOT_DIR;
const AUTOR = "e2e_rp_autor";
const SEGUIDO = "e2e_rp_seguido";
const OUTRO = "e2e_rp_outro";
const MARK = "e2e-rp:";
const POST = `${MARK} post que vai ser compartilhado`;
const QUOTE = `${MARK} minha citação com comentário`;
const MEU = `${MARK} post do próprio autor`;

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "scroll horizontal").toBeLessThanOrEqual(0);
}
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}
async function me() {
  return (await openE2eDb()
    .prepare("SELECT id, username FROM members WHERE email = ?")
    .get<{ id: number; username: string }>(E2E_MEMBER_EMAIL))!;
}
async function idOf(username: string) {
  return (await openE2eDb().prepare("SELECT id FROM members WHERE username = ?").get<{ id: number }>(username))?.id ?? null;
}
async function postId(body: string) {
  return (
    await openE2eDb().prepare("SELECT id FROM posts WHERE body = ? ORDER BY id DESC").get<{ id: number }>(body)
  )?.id ?? null;
}
async function repostCount(originId: number) {
  const row = await openE2eDb()
    .prepare(`SELECT COUNT(*) AS n FROM posts WHERE "repostOfId" = ?`)
    .get<{ n: number }>(originId);
  return Number(row?.n ?? 0);
}
async function notesOf(memberId: number) {
  return openE2eDb()
    .prepare("SELECT type, text FROM notifications WHERE memberId = ? ORDER BY id")
    .all<{ type: string; text: string }>(memberId);
}

async function cleanup() {
  const db = openE2eDb();
  const eu = await me();
  const ids = (await Promise.all([idOf(AUTOR), idOf(SEGUIDO), idOf(OUTRO)])).filter((x): x is number => x !== null);
  const all = `{${[eu.id, ...ids].join(",")}}`;
  await db
    .prepare(
      `DELETE FROM posts WHERE body LIKE ? OR memberId = ANY(?::int[])
         OR "repostOfId" IN (SELECT id FROM posts WHERE body LIKE ? OR memberId = ANY(?::int[]))`,
    )
    .run(`${MARK}%`, all, `${MARK}%`, all);
  await db.prepare(`DELETE FROM member_follows WHERE memberId = ANY(?::int[]) OR followedId = ANY(?::int[])`).run(all, all);
  await db.prepare(`DELETE FROM notifications WHERE memberId = ANY(?::int[]) OR actorId = ANY(?::int[])`).run(all, all);
  for (const id of ids) await db.prepare("DELETE FROM members WHERE id = ?").run(id);
}

async function seed() {
  const db = openE2eDb();
  const person = async (username: string, name: string) =>
    (await db
      .prepare("INSERT INTO members (clerkId, username, email, name, headline) VALUES (?, ?, ?, ?, ?) RETURNING id")
      .get<{ id: number }>(`clerk_${username}`, username, `${username}@t.dev`, name, "constrói no fim de semana"))!.id;
  const autor = await person(AUTOR, "Autor Repost");
  await person(SEGUIDO, "Seguidor Repost");
  await person(OUTRO, "Outro Repost");
  await db.prepare("INSERT INTO posts (memberId, body) VALUES (?, ?)").run(autor, POST);
}

test.describe.configure({ mode: "serial" });

test.describe("repost e citação", () => {
  test.beforeAll(async () => {
    await cleanup();
    await seed();
  });
  test.afterAll(cleanup);

  test("compartilhar é toggle: o contador anda, o repost existe e o autor é avisado", async ({ memberPage: page }) => {
    const autor = (await idOf(AUTOR))!;
    const eu = await me();
    const origin = (await postId(POST))!;
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/post/${origin}`);

    const share = page.getByTestId("post-share");
    await expect(share).toHaveAttribute("aria-pressed", "false");
    // o card é otimista: espera a resposta da API antes de olhar o banco
    const posted = page.waitForResponse((r) => /\/repost$/.test(r.url()) && r.request().method() === "POST");
    await share.click();
    expect((await posted).status()).toBe(201);
    await expect(share).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("share-count")).toHaveText("1");

    const repost = await openE2eDb()
      .prepare(`SELECT id, body, "repostOfId" FROM posts WHERE memberId = ? AND "repostOfId" = ?`)
      .get<{ id: number; body: string; repostOfId: number }>(eu.id, origin);
    expect(repost?.body).toBe("");
    expect(repost?.repostOfId).toBe(origin);
    expect(await notesOf(autor)).toEqual([{ type: "repost", text: `@${eu.username} compartilhou seu post` }]);
    await noHorizontalScroll(page);
    await shot(page, "repost-compartilhar-390");

    // desfaz: o contador volta e o repost sai do banco
    const undone = page.waitForResponse((r) => /\/repost$/.test(r.url()) && r.request().method() === "DELETE");
    await share.click();
    expect((await undone).status()).toBe(200);
    await expect(share).toHaveAttribute("aria-pressed", "false");
    expect(await repostCount(origin)).toBe(0);
  });

  test("citar: corpo próprio, o original na caixa e o aviso de citação", async ({ memberPage: page }) => {
    const autor = (await idOf(AUTOR))!;
    const origin = (await postId(POST))!;
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/post/${origin}`);

    await page.getByTestId("post-quote").click();
    const form = page.getByTestId("quote-form");
    await expect(form).toContainText(`citando @${AUTOR}`);
    await form.getByRole("textbox").fill(QUOTE);
    await form.getByRole("button", { name: /citar/ }).click();

    await expect(page).toHaveURL(/\/post\/\d+$/);
    await expect(page.getByTestId("post-card")).toContainText(QUOTE);
    await expect(page.getByTestId("quote-box")).toContainText(POST);
    const citada = await openE2eDb()
      .prepare(`SELECT "quoteOfId" FROM posts WHERE body = ?`)
      .get<{ quoteOfId: number }>(QUOTE);
    expect(citada?.quoteOfId).toBe(origin);
    expect(await notesOf(autor)).toContainEqual({ type: "quote", text: `@${(await me()).username} citou seu post` });
    await noHorizontalScroll(page);
    await shot(page, "repost-citacao-390");
  });

  test("o autor desliga a citação no menu do post (e o chip aparece)", async ({ memberPage: page }) => {
    const eu = await me();
    const meu = (
      await openE2eDb()
        .prepare("INSERT INTO posts (memberId, body) VALUES (?, ?) RETURNING id")
        .get<{ id: number }>(eu.id, MEU)
    )!.id;
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/post/${meu}`);
    await expect(page.getByTestId("post-no-quote")).toHaveCount(0);

    await page.getByTestId("post-menu").click();
    await page.getByTestId("post-toggle-quote").click();
    await expect(page.getByTestId("post-no-quote")).toBeVisible();
    const off = await openE2eDb().prepare(`SELECT "allowQuote" FROM posts WHERE id = ?`).get<{ allowQuote: number }>(meu);
    expect(Number(off?.allowQuote)).toBe(0);

    await page.getByTestId("post-menu").click();
    await page.getByTestId("post-toggle-quote").click();
    await expect(page.getByTestId("post-no-quote")).toHaveCount(0);
    await noHorizontalScroll(page);
    await shot(page, "repost-sem-citacao-390");
  });

  test("a timeline de quem segue mostra o repost uma vez, com o cabeçalho de quem compartilhou", async ({ memberPage: page }) => {
    const db = openE2eDb();
    const eu = await me();
    const seguido = (await idOf(SEGUIDO))!;
    const outro = (await idOf(OUTRO))!;
    const origin = (await postId(POST))!;
    // o post citado no teste anterior também é meu: ele aparece na timeline,
    // então o recorte é pelo cabeçalho do repost
    await db.prepare("INSERT INTO member_follows (memberId, followedId) VALUES (?, ?), (?, ?)").run(eu.id, seguido, eu.id, outro);
    await db.prepare(`INSERT INTO posts (memberId, body, "repostOfId") VALUES (?, '', ?)`).run(seguido, origin);

    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/feed?aba=seguindo");
    const card = page.getByTestId("repost-card").first();
    await expect(card.getByTestId("repost-header")).toContainText(`@${SEGUIDO} compartilhou`);
    await expect(card).toContainText(POST);

    // o segundo repost entra no mesmo item: "@a e @b compartilharam"
    await db.prepare(`INSERT INTO posts (memberId, body, "repostOfId") VALUES (?, '', ?)`).run(outro, origin);
    await page.reload();
    const cards = page.getByTestId("repost-card");
    await expect(cards).toHaveCount(1);
    await expect(cards.first().getByTestId("repost-header")).toContainText(`@${SEGUIDO} e @${OUTRO} compartilharam`);
    await noHorizontalScroll(page);
    await shot(page, "repost-timeline-390");
  });
});
