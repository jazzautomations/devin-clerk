import { expect, type Page } from "@playwright/test";
import { E2E_MEMBER_EMAIL, memberRequest, test } from "./auth";
import { openE2eDb } from "./db";

// Menções @ e tags # (spec 046, onda 2, migration 039): autocomplete no
// teclado, menção que vira link e avisa, # que leva pra /tag/[tag] com post,
// projeto, pessoa e hackathon, forma canônica da URL (308), @ de quem não
// existe e de quem bloqueou (texto, sem link) e 390px sem scroll.

const SHOTS = process.env.E2E_SHOT_DIR;
const AMIGO = "e2e_mt_amigo";
const BLOQ = "e2e_mt_bloq";
const ED = "e2e-mt-ed";
const PROJETO = "E2E Radar de Tags";
const TAG = "nextjs";

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

let myPost = 0;
let semLink = 0;

async function cleanup() {
  const db = openE2eDb();
  const meId = await me();
  const ids = (await Promise.all([AMIGO, BLOQ].map(idOf))).filter((x): x is number => x !== null);
  const all = `{${[meId, ...ids].join(",")}}`;
  await db.prepare(`DELETE FROM posts WHERE "memberId" = ? AND body LIKE 'e2e mencoes%'`).run(meId);
  await db.prepare(`DELETE FROM notifications WHERE "memberId" = ANY(?::int[]) AND type = 'mention'`).run(all);
  await db.prepare(`DELETE FROM member_blocks WHERE "memberId" = ANY(?::int[]) OR "blockedId" = ANY(?::int[])`).run(all, all);
  await db
    .prepare(`DELETE FROM project_tech WHERE "teamId" IN (SELECT id FROM teams WHERE "hackathonId" = ?)`)
    .run(ED);
  await db.prepare(`DELETE FROM team_projects WHERE title = ?`).run(PROJETO);
  await db.prepare(`DELETE FROM teams WHERE "hackathonId" = ?`).run(ED);
  await db.prepare("DELETE FROM hackathons WHERE id = ?").run(ED);
  for (const id of ids) await db.prepare("DELETE FROM members WHERE id = ?").run(id);
}

async function seed() {
  const db = openE2eDb();
  const meId = await me();
  const person = async (username: string, name: string, skills: string[]) =>
    (await db
      .prepare(`INSERT INTO members ("clerkId", username, email, name, skills, headline) VALUES (?, ?, ?, ?, ?, 'faz demo') RETURNING id`)
      .get<{ id: number }>(`clerk_${username}`, username, `${username}@t.dev`, name, JSON.stringify(skills)))!.id;
  const amigo = await person(AMIGO, "Amigo da Menção", ["Next.js"]);
  const bloq = await person(BLOQ, "Quem Bloqueou", ["Figma"]);
  // quem bloqueou o membro e2e: a menção a ele não vira link nem avisa
  await db.prepare(`INSERT INTO member_blocks ("memberId", "blockedId") VALUES (?, ?)`).run(bloq, meId);
  // edição aberta com a tag e um projeto com a mesma tag
  await db
    .prepare(
      `INSERT INTO hackathons (id, name, organizer, startsAt, format, "registrationUrl", tags, active, source)
       VALUES (?, 'Hack E2E das Tags', 'Org', '2030-01-10 09:00:00', 'online', 'https://exemplo.dev', ?, 1, 'painel')`,
    )
    .run(ED, JSON.stringify(["Next.js"]));
  const team = (await db
    .prepare(`INSERT INTO teams ("hackathonId", name) VALUES (?, 'Time das Tags') RETURNING id`)
    .get<{ id: number }>(ED))!.id;
  await db
    .prepare(`INSERT INTO team_projects ("teamId", title, description) VALUES (?, ?, 'projeto de teste da tag')`)
    .run(team, PROJETO);
  await db.prepare(`INSERT INTO project_tech ("teamId", tag) VALUES (?, ?)`).run(team, TAG);
  return { amigo, bloq };
}

test.describe.configure({ mode: "serial" });

test.describe("menções e tags", () => {
  test.beforeAll(async () => {
    await cleanup();
    await seed();
  });
  test.afterAll(cleanup);

  test("autocomplete no teclado escolhe o @ e o post avisa quem foi mencionado", async ({ memberPage: page }) => {
    await page.goto("/feed");
    const composer = page.getByTestId("post-composer");
    const campo = composer.getByRole("textbox", { name: "o que você está construindo" });
    await campo.fill("e2e mencoes: oi @e2e_mt_am");
    const lista = page.getByTestId("mention-suggest");
    await expect(lista).toBeVisible();
    await expect(lista.getByRole("option")).toHaveCount(1);
    await expect(lista.getByRole("option")).toContainText(`@${AMIGO}`);
    // Esc fecha sem escolher; digitar de novo reabre
    await campo.press("Escape");
    await expect(lista).toHaveCount(0);
    await campo.pressSequentially("i");
    await expect(lista).toBeVisible();
    // setas navegam, Enter escolhe (não envia nada)
    await campo.press("ArrowDown");
    await campo.press("ArrowUp");
    await campo.press("ArrowDown");
    await campo.press("Enter");
    await expect(campo).toHaveValue(`e2e mencoes: oi @${AMIGO} `);
    await campo.pressSequentially("usei #nextjs");
    await composer.getByRole("button", { name: /postar/ }).click();

    const db = openE2eDb();
    const meId = await me();
    const findPost = () =>
      db
        .prepare(`SELECT id, body FROM posts WHERE "memberId" = ? AND body LIKE 'e2e mencoes%' ORDER BY id DESC LIMIT 1`)
        .get<{ id: number; body: string }>(meId);
    await expect.poll(async () => (await findPost())?.body ?? null).toBe(`e2e mencoes: oi @${AMIGO} usei #nextjs`);
    myPost = (await findPost())!.id;
    const amigoId = (await idOf(AMIGO))!;
    // o índice é escrito depois do INSERT do post: espera ele aparecer
    const mentionRows = () =>
      db
        .prepare(`SELECT "memberId", "commentId" FROM post_mentions WHERE "postId" = ?`)
        .all<{ memberId: number; commentId: number | null }>(myPost);
    await expect.poll(async () => (await mentionRows()).length).toBe(1);
    expect(await mentionRows()).toEqual([{ memberId: amigoId, commentId: null }]);
    const tagRows = () => db.prepare(`SELECT tag FROM post_tags WHERE "postId" = ?`).all<{ tag: string }>(myPost);
    await expect.poll(async () => (await tagRows()).length).toBe(1);
    expect((await tagRows()).map((t) => t.tag)).toEqual([TAG]);
    const noteRows = () =>
      db
        .prepare(`SELECT type, text, href FROM notifications WHERE "memberId" = ? AND type = 'mention'`)
        .all<{ type: string; text: string; href: string }>(amigoId);
    await expect.poll(async () => (await noteRows()).length).toBe(1);
    const note = await noteRows();
    expect(note[0].text).toContain("mencionou você");
    expect(note[0].href).toBe(`/post/${myPost}`);
    // no feed o @ e a # já aparecem como link
    const card = page.getByTestId("post-card").filter({ hasText: "e2e mencoes:" }).first();
    await expect(card.locator(`a[data-mention="${AMIGO}"]`)).toHaveAttribute("href", `/u/${AMIGO}`);
    await expect(card.locator(`a[data-tag="${TAG}"]`)).toHaveAttribute("href", `/tag/${TAG}`);
  });

  test("no /post a menção vira link e a tag leva pra /tag com post, projeto, pessoa e hackathon", async ({
    memberPage: page,
  }) => {
    await page.goto(`/post/${myPost}`);
    const corpo = page.getByTestId("post-card").locator("[data-post-body]");
    await expect(corpo.locator(`a[data-mention="${AMIGO}"]`)).toHaveText(`@${AMIGO}`);
    await corpo.locator(`a[data-tag="${TAG}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/tag/${TAG}$`));
    await expect(page).toHaveTitle(`#${TAG} no HackaHub`);
    await expect(page.getByTestId("tag-posts").getByText("e2e mencoes:")).toBeVisible();
    const projetos = page.getByTestId("tag-projects");
    await expect(projetos.getByRole("link", { name: PROJETO })).toHaveAttribute("href", /^\/p\/\d+$/);
    await expect(page.getByTestId("tag-people").getByRole("link", { name: "Amigo da Menção" })).toHaveAttribute(
      "href",
      `/u/${AMIGO}`,
    );
    await expect(page.getByTestId("tag-hackathons")).toContainText("Hack E2E das Tags");
    // clicar no @ do post leva pro perfil
    await page.goto(`/post/${myPost}`);
    await page.getByTestId("post-card").locator(`a[data-mention="${AMIGO}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/u/${AMIGO}$`));
  });

  test("#Next.js e #nextjs são a mesma página (308 pra forma canônica)", async ({ memberPage: page }) => {
    await page.goto("/tag/next.js");
    await expect(page).toHaveURL(new RegExp(`/tag/${TAG}$`));
    await expect(page.getByTestId("tag-posts").getByText("e2e mencoes:")).toBeVisible();
    const res = await page.request.get("/tag/Next.js", { maxRedirects: 0 });
    expect(res.status()).toBe(308);
    expect(res.headers()["location"]).toMatch(new RegExp(`/tag/${TAG}$`));
  });

  test("@ de quem não existe e de quem bloqueou fica texto e não avisa", async ({ memberPage: page }) => {
    // navegar antes renova o __session do Clerk que o request da página usa
    const request = await memberRequest(page);
    const res = await request.post("/api/posts", {
      data: { body: "e2e mencoes: sem link @nao_existe_aqui e @e2e_mt_bloq" },
    });
    expect(res.status()).toBe(201);
    semLink = ((await res.json()) as { post: { id: number } }).post.id;
    const db = openE2eDb();
    const mention = await db
      .prepare(`SELECT "memberId" FROM post_mentions WHERE "postId" = ?`)
      .all<{ memberId: number }>(semLink);
    expect(mention).toEqual([]);
    const note = await db
      .prepare(`SELECT 1 AS y FROM notifications WHERE "memberId" = ? AND type = 'mention'`)
      .all<{ y: number }>((await idOf(BLOQ))!);
    expect(note).toEqual([]);
    await page.goto(`/post/${semLink}`);
    const corpo = page.getByTestId("post-card").locator("[data-post-body]");
    await expect(corpo).toContainText("@nao_existe_aqui");
    await expect(corpo).toContainText(`@${BLOQ}`);
    await expect(corpo.locator("a[data-mention]")).toHaveCount(0);
  });

  test("tag sem nada: o texto do vazio e a caixa já com #tag", async ({ memberPage: page }) => {
    await page.goto("/tag/tagsemninguem");
    await expect(page.getByTestId("tag-posts-empty")).toHaveText(
      "Ninguém usou #tagsemninguem ainda. Escreva o primeiro post.",
    );
    await expect(page.getByTestId("post-composer").getByRole("textbox", { name: "o que você está construindo" })).toHaveValue(
      "#tagsemninguem ",
    );
    await expect(page.getByTestId("tag-projects")).toHaveCount(0);
    await expect(page.getByTestId("tag-people")).toHaveCount(0);
    await expect(page.getByTestId("tag-hackathons")).toHaveCount(0);
  });

  test("deslogado: /tag manda pro cadastro", async ({ page }) => {
    await page.goto(`/tag/${TAG}`);
    await expect(page).toHaveURL(/\/sign-up/);
  });

  test("390px: /post e /tag sem scroll horizontal", async ({ memberPage: page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/post/${myPost}`);
    await expect(page.getByTestId("post-card")).toBeVisible();
    await noHorizontalScroll(page);
    await page.goto(`/tag/${TAG}`);
    await expect(page.getByTestId("tag-posts")).toBeVisible();
    await noHorizontalScroll(page);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/tag-390.png`, fullPage: true });
  });
});
