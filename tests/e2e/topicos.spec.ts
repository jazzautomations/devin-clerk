import { expect, type Page } from "@playwright/test";
import { E2E_MEMBER_EMAIL, test } from "./auth";
import { openE2eDb } from "./db";

// Tópicos da comunidade (spec 046 onda 1, migration 058), no celular:
// abrir pergunta, responder em 3 níveis, aceitar resposta, votar/trocar/
// desfazer, enquete com voto único, ordenar, fixar e trancar como
// organizador, remover mantendo a árvore, não-membro sem botão de postar e
// 390px sem scroll horizontal.

const COM = "e2e-topicos";
const FORA = "e2e-topicos-fora"; // o membro e2e não é membro
const AUTOR = "e2e_tp_autor";
const MOBILE = { width: 390, height: 844 };

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

type Seed = { autorTopic: number; pollTopic: number; parentReply: number; childReply: number };
let seed: Seed;

async function cleanup() {
  const db = openE2eDb();
  const autor = await idOf(AUTOR);
  for (const slug of [COM, FORA]) await db.prepare("DELETE FROM communities WHERE slug = ?").run(slug);
  await db.prepare(`DELETE FROM notifications WHERE "memberId" = ? AND type = 'topic-reply'`).run(await me());
  if (autor) {
    await db.prepare(`DELETE FROM notifications WHERE "memberId" = ? OR "actorId" = ?`).run(autor, autor);
    await db.prepare("DELETE FROM members WHERE id = ?").run(autor);
  }
}

async function seedAll(): Promise<Seed> {
  const db = openE2eDb();
  const meId = await me();
  const autor = (await db
    .prepare(`INSERT INTO members ("clerkId", username, email, name) VALUES (?, ?, ?, 'Autora dos Tópicos') RETURNING id`)
    .get<{ id: number }>(`clerk_${AUTOR}`, AUTOR, `${AUTOR}@t.dev`))!.id;
  const c = (await db
    .prepare(`INSERT INTO communities (slug, name, city, description) VALUES (?, 'E2E Tópicos', 'Recife, PE', 'teste dos tópicos') RETURNING id`)
    .get<{ id: number }>(COM))!.id;
  // o membro e2e organiza: fixa, tranca e remove
  await db.prepare(`INSERT INTO community_members ("communityId", "memberId", role) VALUES (?, ?, 'organizador'), (?, ?, 'membro')`).run(c, meId, c, autor);
  const fora = (await db
    .prepare(`INSERT INTO communities (slug, name, city) VALUES (?, 'E2E Tópicos de Fora', 'Recife, PE') RETURNING id`)
    .get<{ id: number }>(FORA))!.id;
  await db.prepare(`INSERT INTO community_members ("communityId", "memberId", role) VALUES (?, ?, 'dono')`).run(fora, autor);
  await db
    .prepare(`INSERT INTO community_topics ("communityId", "memberId", title, body) VALUES (?, ?, 'Tópico de quem não sou eu', 'olha só')`)
    .run(fora, autor);
  const topic = (title: string, kind = "discussao", hoursAgo = 0) =>
    db
      .prepare(
        `INSERT INTO community_topics ("communityId", "memberId", title, body, kind, "createdAt", "lastActivityAt")
         VALUES (?, ?, ?, 'texto da autora com **negrito**', ?, sqlite_now(?), sqlite_now(?)) RETURNING id`,
      )
      .get<{ id: number }>(c, autor, title, kind, `-${hoursAgo} hours`, `-${hoursAgo} hours`)
      .then((r) => r!.id);
  const autorTopic = await topic("Bora montar um time pro próximo?", "discussao", 30);
  const pollTopic = await topic("Qual stack no próximo hackathon?", "enquete", 2);
  for (const [i, label] of ["Next", "Remix", "Astro"].entries()) {
    await db.prepare(`INSERT INTO topic_poll_options ("topicId", label, position) VALUES (?, ?, ?)`).run(pollTopic, label, i);
  }
  const parentReply = (await db
    .prepare(`INSERT INTO topic_replies ("topicId", "memberId", body) VALUES (?, ?, 'resposta que vai ser removida') RETURNING id`)
    .get<{ id: number }>(autorTopic, autor))!.id;
  const childReply = (await db
    .prepare(`INSERT INTO topic_replies ("topicId", "parentId", "memberId", depth, body) VALUES (?, ?, ?, 2, 'filha que fica') RETURNING id`)
    .get<{ id: number }>(autorTopic, parentReply, autor))!.id;
  await db.prepare(`UPDATE community_topics SET "replyCount" = 2 WHERE id = ?`).run(autorTopic);
  return { autorTopic, pollTopic, parentReply, childReply };
}

/** clique que pode cair antes da hidratação: repete até o efeito aparecer */
async function clickUntil(page: Page, click: () => Promise<void>, check: () => Promise<void>) {
  await expect(async () => {
    await click();
    await check();
  }).toPass({ timeout: 15_000 });
}

test.describe.configure({ mode: "serial" });

test.describe("tópicos da comunidade", () => {
  test.beforeAll(async () => {
    await cleanup();
    seed = await seedAll();
  });
  test.afterAll(cleanup);

  test("anon: tópicos mandam pro cadastro e a API dá 401; o cartão público conta os tópicos", async ({ page, request }) => {
    await page.goto(`/comunidade/${COM}/t`);
    await expect(page).toHaveURL(/\/sign-up/);
    const res = await request.get(`/api/communities/${COM}/topics`);
    expect(res.status()).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    await page.goto(`/comunidade/${COM}`);
    const row = page.locator("dl > div").filter({ has: page.locator("dt", { hasText: /^tópicos$/ }) });
    await expect(row.locator("dd")).toHaveText("2");
  });

  test("abrir pergunta no celular, responder em 3 níveis e marcar a que resolveu", async ({ memberPage: page }) => {
    page.on("dialog", (d) => d.accept());
    await page.setViewportSize(MOBILE);
    await page.goto(`/comunidade/${COM}`);
    await expect(page.getByTestId("community-hot-topics")).toContainText("Bora montar um time");
    await noHorizontalScroll(page);
    await page.getByTestId("community-topics-all").click();
    await expect(page).toHaveURL(new RegExp(`/comunidade/${COM}/t$`));
    await noHorizontalScroll(page);
    await page.getByTestId("topic-new").click();
    await expect(page.getByTestId("topic-form")).toBeVisible();
    await noHorizontalScroll(page);
    await clickUntil(
      page,
      () => page.getByTestId("topic-kind-pergunta").check(),
      () => expect(page.getByTestId("topic-kind-pergunta")).toBeChecked({ timeout: 1500 }),
    );
    await page.getByTestId("topic-title").fill("Como vocês sobem o Postgres no hackathon?");
    await page.getByTestId("topic-body").fill("Docker, **Neon** ou o quê?");
    await page.getByTestId("topic-flair").fill("infra");
    await page.getByTestId("topic-submit").click();
    await expect(page).toHaveURL(new RegExp(`/comunidade/${COM}/t/\\d+$`));
    await expect(page.getByTestId("topic-title")).toHaveText("Como vocês sobem o Postgres no hackathon?");
    await expect(page.getByTestId("topic-body").locator("strong")).toHaveText("Neon");
    await expect(page.getByTestId("topic-flair")).toHaveText("infra");
    await expect(page.getByTestId("replies-empty")).toBeVisible();
    await noHorizontalScroll(page);

    // nível 1
    await page.getByTestId("topic-reply-composer").getByTestId("reply-body").fill("nível 1: docker compose");
    await page.getByTestId("topic-reply-composer").getByTestId("reply-send").click();
    const l1 = page.locator('[data-testid="reply"][data-depth="1"]');
    await expect(l1).toContainText("nível 1: docker compose");
    // nível 2 e 3, respondendo no lugar
    await l1.getByTestId("reply-open").first().click();
    await l1.getByTestId("reply-composer").getByTestId("reply-body").fill("nível 2: e o volume?");
    await l1.getByTestId("reply-composer").getByTestId("reply-send").click();
    const l2 = page.locator('[data-testid="reply"][data-depth="2"]');
    await expect(l2).toContainText("nível 2: e o volume?");
    await l2.getByTestId("reply-open").first().click();
    await l2.getByTestId("reply-composer").getByTestId("reply-body").fill("nível 3: volume nomeado");
    await l2.getByTestId("reply-composer").getByTestId("reply-send").click();
    const l3 = page.locator('[data-testid="reply"][data-depth="3"]');
    await expect(l3).toContainText("nível 3: volume nomeado");
    await expect(page.getByRole("heading", { name: "3 respostas" })).toBeVisible();
    await noHorizontalScroll(page);

    // colapsar o galho esconde as filhas
    await l1.getByTestId("reply-collapse").first().click();
    await expect(l2).toHaveCount(0);
    await expect(l1).toContainText("2 escondidas");
    await l1.getByTestId("reply-collapse").first().click();
    await expect(l3).toBeVisible();

    // a pergunta é minha: marco a que resolveu
    await l3.getByTestId("reply-accept").click();
    await expect(l3.getByText("resolveu", { exact: true })).toBeVisible();
    await expect(page.getByTestId("topic-resolved-link")).toBeVisible();
    // não voto no próprio
    await expect(page.getByTestId("topic").getByTestId("vote-up").first()).toBeDisabled();
  });

  test("votar, trocar e desfazer no tópico de outra pessoa", async ({ memberPage: page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(`/comunidade/${COM}/t/${seed.autorTopic}`);
    const topic = page.getByTestId("topic");
    const up = topic.getByTestId("vote-up").first();
    const down = topic.getByTestId("vote-down").first();
    const score = topic.getByTestId("vote-score").first();
    await clickUntil(
      page,
      () => up.click(),
      () => expect(up).toHaveAttribute("aria-pressed", "true", { timeout: 1500 }),
    );
    await expect(score).toHaveText("1");
    const db = openE2eDb();
    const stored = async () => (await db.prepare("SELECT score FROM community_topics WHERE id = ?").get<{ score: number }>(seed.autorTopic))!.score;
    await expect.poll(stored).toBe(1);
    await down.click();
    await expect(score).toHaveText("-1");
    await expect.poll(stored).toBe(-1);
    await down.click();
    await expect(score).toHaveText("0");
    await expect.poll(stored).toBe(0);
    await page.reload();
    await expect(page.getByTestId("topic").getByTestId("vote-score").first()).toHaveText("0");
  });

  test("enquete: voto único, trocar a opção não soma voto", async ({ memberPage: page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(`/comunidade/${COM}/t/${seed.pollTopic}`);
    const poll = page.getByTestId("topic-poll");
    const options = poll.getByTestId("poll-option");
    await expect(options).toHaveCount(3);
    await clickUntil(
      page,
      () => options.nth(0).click(),
      () => expect(options.nth(0)).toHaveAttribute("aria-pressed", "true", { timeout: 1500 }),
    );
    await expect(page.getByTestId("poll-total")).toContainText("1 voto");
    await options.nth(1).click();
    await expect(options.nth(1)).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("poll-total")).toContainText("1 voto");
    await expect(options.nth(1)).toContainText("100%");
    await noHorizontalScroll(page);
  });

  test("ordenar: novos, mais votados e sem resposta", async ({ memberPage: page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(`/comunidade/${COM}/t?ordem=novos`);
    const titles = page.getByTestId("topic-list").getByTestId("topic-link");
    await expect(titles.first()).toContainText("Como vocês sobem o Postgres");
    await expect(titles.last()).toContainText("Bora montar um time");
    await page.getByTestId("topics-sort-top").click();
    await expect(page).toHaveURL(/ordem=top/);
    await expect(page.getByTestId("topics-period-semana")).toHaveAttribute("aria-current", "true");
    await page.getByTestId("topics-sort-sem-resposta").click();
    await expect(page).toHaveURL(/ordem=sem-resposta/);
    // a enquete não tem resposta; a pergunta resolvida e o tópico com conversa saem
    await expect(page.getByTestId("topic-list")).toContainText("Qual stack no próximo hackathon?");
    await expect(page.getByTestId("topic-list")).not.toContainText("Como vocês sobem o Postgres");
    await expect(page.getByTestId("topic-list")).not.toContainText("Bora montar um time");
    // flair e busca
    await page.goto(`/comunidade/${COM}/t`);
    await page.getByTestId("topics-flair").filter({ hasText: "infra" }).click();
    await expect(page).toHaveURL(/flair=infra/);
    await expect(page.getByTestId("topic-row")).toHaveCount(1);
    await page.goto(`/comunidade/${COM}/t`);
    await page.getByTestId("topics-search").fill("stack");
    await page.getByTestId("topics-search").press("Enter");
    await expect(page).toHaveURL(/q=stack/);
    await expect(page.getByTestId("topic-row")).toHaveCount(1);
    await noHorizontalScroll(page);
  });

  test("organizador fixa, remove resposta mantendo a árvore e tranca", async ({ memberPage: page }) => {
    page.on("dialog", (d) => d.accept());
    await page.setViewportSize(MOBILE);
    await page.goto(`/comunidade/${COM}/t/${seed.autorTopic}`);
    const mod = page.getByTestId("topic-mod");
    await clickUntil(
      page,
      () => mod.getByTestId("topic-pin").click(),
      () => expect(mod.getByTestId("topic-pin")).toHaveText("soltar", { timeout: 3000 }),
    );
    await page.goto(`/comunidade/${COM}/t`);
    await expect(page.getByTestId("topics-pinned")).toContainText("Bora montar um time");
    await expect(page.getByTestId("topics-pinned")).toContainText("fixado");

    await page.goto(`/comunidade/${COM}/t/${seed.autorTopic}`);
    const parent = page.locator(`#r-${seed.parentReply}`);
    await clickUntil(
      page,
      () => parent.getByTestId("reply-remove").first().click(),
      () => expect(parent.getByTestId("reply-placeholder").first()).toHaveText("[removido pela moderação]", { timeout: 3000 }),
    );
    await expect(page.locator(`#r-${seed.childReply}`)).toContainText("filha que fica");

    await page.getByTestId("topic-mod").getByTestId("topic-lock").click();
    await expect(page.getByTestId("topic-locked-note")).toBeVisible();
    await expect(page.getByTestId("topic-reply-composer")).toHaveCount(0);
    await expect(page.getByTestId("reply-open")).toHaveCount(0);
    await noHorizontalScroll(page);
    const locked = await openE2eDb().prepare(`SELECT "lockedAt", "pinnedAt" FROM community_topics WHERE id = ?`).get<{ lockedAt: string | null; pinnedAt: string | null }>(seed.autorTopic);
    expect(locked!.lockedAt).toBeTruthy();
    expect(locked!.pinnedAt).toBeTruthy();
  });

  test("quem não é membro lê, mas não vê botão de abrir tópico nem de responder", async ({ memberPage: page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(`/comunidade/${FORA}/t`);
    await expect(page.getByTestId("topic-row")).toHaveCount(1);
    await expect(page.getByTestId("topic-new")).toHaveCount(0);
    await expect(page.getByTestId("community-join")).toBeVisible();
    await expect(page.getByTestId("vote-up").first()).toBeDisabled();
    await page.getByTestId("topic-link").first().click();
    await expect(page.getByTestId("topic-join-hint")).toBeVisible();
    await expect(page.getByTestId("topic-reply-composer")).toHaveCount(0);
    await noHorizontalScroll(page);
    await page.goto(`/comunidade/${FORA}/t/novo`);
    await expect(page.getByTestId("topic-new-join")).toBeVisible();
    await expect(page.getByTestId("topic-form")).toHaveCount(0);
  });
});
