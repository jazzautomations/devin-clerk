import { expect, type Page } from "@playwright/test";
import { E2E_MEMBER_EMAIL, test } from "./auth";
import { openE2eDb } from "./db";

// Conversa no post (spec 046, migration 034): reagir, responder, editar,
// abrir pela notificação no comentário certo, moderador apaga no mural da
// comunidade, denúncia pelo menu e 390px sem scroll no /post.

const SHOTS = process.env.E2E_SHOT_DIR;
const AUTOR = "e2e_cp_autor";
const OUTRO = "e2e_cp_outro"; // é denunciado no fim (denunciar bloqueia)
const COM = "e2e-cp-com";
const MARK = "e2e conversa: post do autor";

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "scroll horizontal").toBeLessThanOrEqual(0);
}
async function me() {
  return (await openE2eDb().prepare("SELECT id FROM members WHERE email = ?").get<{ id: number }>(E2E_MEMBER_EMAIL))!.id;
}
async function idOf(username: string) {
  return (await openE2eDb().prepare("SELECT id FROM members WHERE username = ?").get<{ id: number }>(username))?.id ?? null;
}

type Seed = { autorPost: number; topComment: number; myPost: number; myComment: number; comPost: number; outroPost: number; note: number };
let seed: Seed;

async function cleanup() {
  const db = openE2eDb();
  const meId = await me();
  const ids = (await Promise.all([AUTOR, OUTRO].map(idOf))).filter((x): x is number => x !== null);
  const all = `{${[meId, ...ids].join(",")}}`;
  await db.prepare(`DELETE FROM reports WHERE "reporterId" = ANY(?::int[]) AND "targetType" = 'post'`).run(all);
  await db.prepare(`DELETE FROM member_blocks WHERE "memberId" = ANY(?::int[]) OR "blockedId" = ANY(?::int[])`).run(all, all);
  await db.prepare(`DELETE FROM notifications WHERE "memberId" = ? AND text LIKE '%e2e_cp_%'`).run(meId);
  await db.prepare(`DELETE FROM posts WHERE "memberId" = ? AND body LIKE 'e2e conversa%'`).run(meId);
  const c = await db.prepare("SELECT id FROM communities WHERE slug = ?").get<{ id: number }>(COM);
  if (c) {
    await db.prepare(`DELETE FROM reports WHERE "communityId" = ?`).run(c.id);
    await db.prepare(`DELETE FROM posts WHERE "communityId" = ?`).run(c.id);
    await db.prepare("DELETE FROM community_members WHERE \"communityId\" = ?").run(c.id);
    await db.prepare("DELETE FROM communities WHERE id = ?").run(c.id);
  }
  for (const id of ids) {
    await db.prepare(`DELETE FROM notifications WHERE "memberId" = ?`).run(id);
    await db.prepare(`DELETE FROM post_comments WHERE "memberId" = ?`).run(id);
    await db.prepare(`DELETE FROM likes WHERE "memberId" = ?`).run(id);
    await db.prepare(`DELETE FROM posts WHERE "memberId" = ?`).run(id);
    await db.prepare("DELETE FROM members WHERE id = ?").run(id);
  }
}

async function seedAll(): Promise<Seed> {
  const db = openE2eDb();
  const meId = await me();
  const person = async (username: string, name: string) =>
    (await db
      .prepare(`INSERT INTO members ("clerkId", username, email, name, headline) VALUES (?, ?, ?, ?, 'faz demo')  RETURNING id`)
      .get<{ id: number }>(`clerk_${username}`, username, `${username}@t.dev`, name))!.id;
  const autor = await person(AUTOR, "Autora da Conversa");
  const outro = await person(OUTRO, "Outro Autor");
  const post = (by: number, body: string, link: string | null = null, communityId: number | null = null) =>
    db
      .prepare(`INSERT INTO posts ("memberId", body, link, "communityId") VALUES (?, ?, ?, ?) RETURNING id`)
      .get<{ id: number }>(by, body, link, communityId)
      .then((r) => r!.id);
  const comment = (postId: number, by: number, body: string) =>
    db
      .prepare(`INSERT INTO post_comments ("postId", "memberId", body) VALUES (?, ?, ?) RETURNING id`)
      .get<{ id: number }>(postId, by, body)
      .then((r) => r!.id);
  const autorPost = await post(autor, MARK, `/u/${AUTOR}`);
  const topComment = await comment(autorPost, autor, "e2e conversa: comentário de topo da autora");
  // post do membro e2e com um comentário da autora + a notificação dele
  const myPost = await post(meId, "e2e conversa: meu post");
  const myComment = await comment(myPost, autor, "e2e conversa: a autora comentou no seu");
  const note = (await db
    .prepare(`INSERT INTO notifications ("memberId", "actorId", "actorUsername", type, text, href) VALUES (?, ?, ?, 'comment', ?, ?) RETURNING id`)
    .get<{ id: number }>(meId, autor, AUTOR, `@${AUTOR} comentou no seu post`, `/post/${myPost}#c-${myComment}`))!.id;
  // comunidade em que o membro e2e é dono: ele modera o mural
  const c = (await db
    .prepare(`INSERT INTO communities (slug, name, city, description) VALUES (?, 'E2E Conversa Recife', 'Recife, PE', 'teste da conversa') RETURNING id`)
    .get<{ id: number }>(COM))!.id;
  await db
    .prepare(`INSERT INTO community_members ("communityId", "memberId", role) VALUES (?, ?, 'dono'), (?, ?, 'membro'), (?, ?, 'membro')`)
    .run(c, meId, c, autor, c, outro);
  const comPost = await post(autor, "e2e conversa: post no mural pra moderar", null, c);
  const outroPost = await post(outro, "e2e conversa: post pra denunciar", null, c);
  return { autorPost, topComment, myPost, myComment, comPost, outroPost, note };
}

test.describe.configure({ mode: "serial" });

test.describe("conversa no post", () => {
  test.beforeAll(async () => {
    await cleanup();
    seed = await seedAll();
  });
  test.afterAll(cleanup);

  test("anon: /post manda pro cadastro e as APIs dão 401 JSON", async ({ page, request }) => {
    await page.goto(`/post/${seed.autorPost}`);
    await expect(page).toHaveURL(/\/sign-up/);
    for (const res of [
      await request.post(`/api/posts/${seed.autorPost}/like`, { data: { kind: "ajudou" } }),
      await request.patch(`/api/posts/${seed.autorPost}`, { data: { body: "x" } }),
      await request.get(`/api/posts/${seed.autorPost}`),
      await request.patch(`/api/posts/${seed.autorPost}/comments/${seed.topComment}`, { data: { body: "x" } }),
    ]) {
      expect(res.status()).toBe(401);
      expect(res.headers()["content-type"]).toContain("application/json");
    }
  });

  test("reagir no /post: troca, tira e persiste; link interno vira card", async ({ memberPage: page }) => {
    await page.goto(`/post/${seed.autorPost}`);
    await expect(page).toHaveTitle(new RegExp(`Post de @${AUTOR}`));
    const card = page.getByTestId("post-card");
    await expect(card.locator("[data-post-body]")).toHaveText(MARK);
    await expect(card.getByTestId("link-card")).toHaveAttribute("href", `/u/${AUTOR}`);
    await expect(card.getByTestId("link-card")).toContainText("Autora da Conversa");

    const ajudou = card.getByTestId("reaction-ajudou");
    // clique antes da hidratação não faz nada: repete até o estado mudar
    await expect(async () => {
      await ajudou.click();
      await expect(ajudou).toHaveAttribute("aria-pressed", "true", { timeout: 1500 });
    }).toPass();
    await expect(ajudou).toContainText("1");
    const kindNow = async () =>
      (await openE2eDb().prepare(`SELECT kind FROM likes WHERE "postId" = ? AND "memberId" = ?`).get<{ kind: string }>(seed.autorPost, await me()))?.kind;
    await expect.poll(kindNow).toBe("ajudou");
    const aprendi = card.getByTestId("reaction-aprendi");
    await aprendi.click();
    await expect(aprendi).toHaveAttribute("aria-pressed", "true");
    await expect(ajudou).toHaveAttribute("aria-pressed", "false");
    await expect.poll(kindNow).toBe("aprendi");
    await page.reload();
    await expect(page.getByTestId("reaction-aprendi")).toHaveAttribute("aria-pressed", "true");
    // 1 notificação pra autora, mesmo trocando de reação
    const autor = (await idOf(AUTOR))!;
    const n = await openE2eDb()
      .prepare(`SELECT COUNT(*)::int AS n FROM notifications WHERE "memberId" = ? AND type = 'reaction'`)
      .get<{ n: number }>(autor);
    expect(n!.n).toBe(1);
  });

  test("responder um comentário cria resposta no mesmo fio e avisa a autora", async ({ memberPage: page }) => {
    await page.goto(`/post/${seed.autorPost}`);
    const top = page.locator(`#c-${seed.topComment}`);
    await expect(top).toContainText("comentário de topo da autora");
    await expect(async () => {
      await top.getByRole("button", { name: "responder" }).click();
      await expect(page.getByTestId("reply-form")).toBeVisible({ timeout: 1500 });
    }).toPass();
    await page.getByTestId("reply-form").getByRole("textbox").fill("e2e conversa: minha resposta");
    await page.getByTestId("reply-form").getByRole("button", { name: "responder" }).click();
    const replies = page.getByTestId("replies");
    await expect(replies.getByText("e2e conversa: minha resposta")).toBeVisible();
    const findReply = () =>
      openE2eDb()
        .prepare(`SELECT id, "parentId" FROM post_comments WHERE "postId" = ? AND body = ?`)
        .get<{ id: number; parentId: number }>(seed.autorPost, "e2e conversa: minha resposta");
    await expect.poll(async () => (await findReply())?.parentId).toBe(seed.topComment);
    const row = await findReply();
    expect(row!.parentId).toBe(seed.topComment);
    const note = await openE2eDb()
      .prepare(`SELECT href FROM notifications WHERE "memberId" = ? AND type = 'comment' ORDER BY id DESC LIMIT 1`)
      .get<{ href: string }>((await idOf(AUTOR))!);
    expect(note!.href).toBe(`/post/${seed.autorPost}#c-${row!.id}`);
    // comentário de topo pela caixa de baixo
    await page.getByTestId("comment-form").getByRole("textbox").fill("e2e conversa: comentário novo");
    await page.getByTestId("comment-form").getByRole("button", { name: "comentar" }).click();
    await expect(page.getByTestId("thread").getByText("e2e conversa: comentário novo")).toBeVisible();
  });

  test("abrir a notificação leva ao /post no comentário certo", async ({ memberPage: page }) => {
    await page.goto("/notificacoes");
    await page.getByRole("link", { name: new RegExp(`@${AUTOR} comentou no seu post`) }).click();
    await expect(page).toHaveURL(new RegExp(`/post/${seed.myPost}#c-${seed.myComment}$`));
    const target = page.locator(`#c-${seed.myComment}`);
    await expect(target).toContainText("a autora comentou no seu");
    expect(await target.evaluate((el) => el.matches(":target"))).toBe(true);
    const read = await openE2eDb().prepare("SELECT read FROM notifications WHERE id = ?").get<{ read: number }>(seed.note);
    expect(Number(read!.read)).toBe(1);
  });

  test("editar o próprio post mostra 'editado'", async ({ memberPage: page }) => {
    await page.goto(`/post/${seed.myPost}`);
    const card = page.getByTestId("post-card");
    // não dá pra reagir no próprio post
    await expect(card.getByTestId("reaction-curti")).toBeDisabled();
    await expect(async () => {
      await card.getByTestId("post-menu").click();
      await expect(page.getByRole("menuitem", { name: "editar" })).toBeVisible({ timeout: 1500 });
    }).toPass();
    await page.getByRole("menuitem", { name: "editar" }).click();
    await card.getByLabel("texto do post").fill("e2e conversa: meu post, corrigido");
    await card.getByRole("button", { name: "salvar" }).click();
    await expect(card.locator("[data-post-body]")).toHaveText("e2e conversa: meu post, corrigido");
    await expect(card.getByTestId("post-edited")).toHaveText("editado");
    await page.reload();
    await expect(page.getByTestId("post-edited")).toBeVisible();
  });

  test("dono da comunidade apaga post do mural dela pelo menu", async ({ memberPage: page }) => {
    await page.goto(`/post/${seed.comPost}`);
    page.once("dialog", (d) => d.accept());
    await expect(async () => {
      await page.getByTestId("post-menu").click();
      await expect(page.getByRole("menuitem", { name: "apagar" })).toBeVisible({ timeout: 1500 });
    }).toPass();
    await page.getByRole("menuitem", { name: "apagar" }).click();
    await expect(page).toHaveURL(new RegExp(`/comunidade/${COM}$`));
    await expect.poll(async () => await openE2eDb().prepare("SELECT 1 AS y FROM posts WHERE id = ?").get(seed.comPost)).toBeUndefined();
    expect((await page.goto(`/post/${seed.comPost}`))?.status()).toBe(404);
  });

  test("390px: /post sem scroll horizontal", async ({ memberPage: page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/post/${seed.autorPost}`);
    await expect(page.getByTestId("thread")).toBeVisible();
    await noHorizontalScroll(page);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/post-390.png`, fullPage: true });
    await page.goto(`/post/${seed.myPost}`);
    await noHorizontalScroll(page);
  });

  test("denunciar pelo menu cria linha em reports com a comunidade", async ({ memberPage: page }) => {
    await page.goto(`/post/${seed.outroPost}`);
    await expect(async () => {
      await page.getByTestId("post-menu").click();
      await expect(page.getByTestId("report-open")).toBeVisible({ timeout: 1500 });
    }).toPass();
    await page.getByTestId("report-open").click();
    const dialog = page.getByRole("dialog", { name: "denunciar este post" });
    await dialog.getByRole("radio", { name: "spam ou propaganda" }).check();
    await dialog.getByTestId("report-send").click();
    await expect(dialog.getByRole("status")).toContainText(`Recebido. Você não vai mais ver conteúdo de @${OUTRO}.`);
    const c = await openE2eDb().prepare("SELECT id FROM communities WHERE slug = ?").get<{ id: number }>(COM);
    const row = await openE2eDb()
      .prepare(`SELECT "communityId" FROM reports WHERE "targetType" = 'post' AND "targetId" = ?`)
      .get<{ communityId: number }>(String(seed.outroPost));
    expect(row!.communityId).toBe(c!.id);
    await dialog.getByRole("button", { name: "fechar" }).first().click();
    await expect(page.getByTestId("post-page").getByText(`Você não vai mais ver conteúdo de @${OUTRO}.`)).toBeVisible();
  });
});
