import { expect, type Page } from "@playwright/test";
import { E2E_MEMBER_EMAIL, test } from "./auth";
import { openE2eDb } from "./db";
import { parseEventTime } from "@/lib/eventTime";

// Timeline (spec 046, onda 2, migration 038): /feed com abas cronológicas,
// aba padrão, estado vazio de seguindo (com quem seguir), seguir alguém e ver
// o post dela, o que não aparece, ao vivo, cursor com "carregar mais", o menu
// com feed e buscar, tudo em 390px sem scroll horizontal.

const SHOTS = process.env.E2E_SHOT_DIR;
const SEGUIDO = "e2e_tl_seguido";
const ESTRANHO = "e2e_tl_estranho";
const LIVE = "e2e-timeline-live";
const HACK = "hack-inova-alphaville-2026";
const TEAM = "E2E Timeline Time";
const MARK = "e2e-tl:";
const POST_SEGUIDO = `${MARK} post de quem eu sigo`;
const POST_ESTRANHO = `${MARK} post de quem eu não sigo`;
const POST_LIVE = `${MARK} mural da edição ao vivo`;

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
/**
 * Edições hosted que estão rolando agora, pela mesma regra de lib/timeline.
 * O banco do e2e tem edições de outras specs rolando: pra ver o vazio da aba
 * ao vivo é preciso desligá-las (e religar logo depois).
 */
async function liveEditionIds(): Promise<string[]> {
  const rows = await openE2eDb()
    .prepare("SELECT id, startsAt, endsAt FROM hackathons WHERE active = 1")
    .all<{ id: string; startsAt: string | null; endsAt: string | null }>();
  const agora = new Date();
  const out: string[] = [];
  for (const r of rows) {
    const start = parseEventTime(r.startsAt);
    if (!start) continue;
    const end = parseEventTime(r.endsAt) ?? new Date(start.getTime() + 86_400_000);
    if (agora.getTime() >= start.getTime() && agora.getTime() <= end.getTime()) out.push(r.id);
  }
  return out;
}

async function follows(a: number, b: number) {
  return !!(await openE2eDb()
    .prepare("SELECT 1 AS ok FROM member_follows WHERE memberId = ? AND followedId = ?")
    .get(a, b));
}

async function cleanup() {
  const db = openE2eDb();
  const eu = await me();
  const ids = (await Promise.all([idOf(SEGUIDO), idOf(ESTRANHO)])).filter((x): x is number => x !== null);
  const all = `{${[eu.id, ...ids].join(",")}}`;
  await db.prepare("DELETE FROM posts WHERE body LIKE ?").run(`${MARK}%`);
  await db.prepare(`DELETE FROM member_follows WHERE memberId = ANY(?::int[]) OR followedId = ANY(?::int[])`).run(all, all);
  await db.prepare(`DELETE FROM notifications WHERE memberId = ANY(?::int[]) OR actorId = ANY(?::int[])`).run(all, all);
  await db.prepare("DELETE FROM hackathons WHERE id = ?").run(LIVE);
  const t = await db.prepare("SELECT id FROM teams WHERE hackathonId = ? AND name = ?").get<{ id: number }>(HACK, TEAM);
  if (t) {
    await db.prepare("DELETE FROM team_members WHERE teamId = ?").run(t.id);
    await db.prepare("DELETE FROM teams WHERE id = ?").run(t.id);
  }
  for (const id of ids) await db.prepare("DELETE FROM members WHERE id = ?").run(id);
}

async function seed() {
  const db = openE2eDb();
  const eu = await me();
  const person = async (username: string, name: string) =>
    (await db
      .prepare("INSERT INTO members (clerkId, username, email, name, headline) VALUES (?, ?, ?, ?, ?) RETURNING id")
      .get<{ id: number }>(`clerk_${username}`, username, `${username}@t.dev`, name, "constrói no fim de semana"))!.id;
  const seguido = await person(SEGUIDO, "Seguido Timeline");
  const estranho = await person(ESTRANHO, "Estranho Timeline");
  // fez time com o membro e2e: é a primeira sugestão do vazio de seguindo
  const t = await db
    .prepare("INSERT INTO teams (hackathonId, name) VALUES (?, ?) RETURNING id")
    .get<{ id: number }>(HACK, TEAM);
  await db.prepare("INSERT INTO team_members (teamId, username) VALUES (?, ?), (?, ?)").run(t!.id, eu.username, t!.id, SEGUIDO);
  await db.prepare("INSERT INTO posts (memberId, body) VALUES (?, ?)").run(seguido, POST_SEGUIDO);
  await db.prepare("INSERT INTO posts (memberId, body) VALUES (?, ?)").run(estranho, POST_ESTRANHO);
}

test.describe.configure({ mode: "serial" });

test.describe("timeline", () => {
  test.beforeAll(async () => {
    await cleanup();
    await seed();
  });
  test.afterAll(cleanup);

  test("abas: sem seguir ninguém abre no 'tudo', as quatro abas com aria-current", async ({ memberPage: page }) => {
    for (const vw of [1280, 390]) {
      await page.setViewportSize({ width: vw, height: 900 });
      await page.goto("/feed");
      const tabs = page.getByTestId("feed-tabs");
      await expect(tabs).toBeVisible();
      for (const aba of ["seguindo", "comunidades", "ao-vivo", "tudo"]) {
        await expect(page.getByTestId(`feed-tab-${aba}`)).toBeVisible();
      }
      // ninguém seguido ainda: a aba padrão é o tudo
      await expect(page.getByTestId("feed-tab-tudo")).toHaveAttribute("aria-current", "page");
      await expect(page.getByTestId("timeline")).toHaveAttribute("data-aba", "tudo");
      await noHorizontalScroll(page);
      await shot(page, `timeline-abas-${vw === 390 ? "390" : "desktop"}`);
    }
    // cada aba é um link (?aba=) e marca o aria-current ao abrir
    for (const aba of ["seguindo", "comunidades", "ao-vivo", "tudo"]) {
      await page.getByTestId(`feed-tab-${aba}`).click();
      await expect(page).toHaveURL(new RegExp(`/feed\\?aba=${aba}$`));
      await expect(page.getByTestId(`feed-tab-${aba}`)).toHaveAttribute("aria-current", "page");
    }
  });

  test("vazio de seguindo: o que fazer, com quem seguir e comunidades", async ({ memberPage: page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/feed?aba=seguindo");
    const empty = page.getByTestId("feed-following-empty");
    await expect(empty).toContainText("Sua timeline aparece quando você segue alguém.");
    const people = page.getByTestId("feed-suggest-people");
    await expect(people).toBeVisible();
    await expect(people).toContainText("Seguido Timeline");
    await expect(people).toContainText("fez time com você");
    await expect(page.getByTestId("feed-suggest-communities")).toBeVisible();
    await noHorizontalScroll(page);
    await shot(page, "timeline-vazio-seguindo-390");
  });

  test("segue quem o vazio sugeriu e o post dela aparece no seguindo", async ({ memberPage: page }) => {
    const eu = await me();
    const seguido = (await idOf(SEGUIDO))!;
    await page.goto("/feed?aba=seguindo");
    const btn = page.getByTestId(`follow-${SEGUIDO}`).getByTestId("follow-button");
    await btn.click();
    await expect(btn).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => follows(eu.id, seguido)).toBe(true);

    // seguindo alguém, o /feed passa a abrir no seguindo
    await page.goto("/feed");
    await expect(page.getByTestId("feed-tab-seguindo")).toHaveAttribute("aria-current", "page");
    const list = page.getByTestId("timeline-posts");
    await expect(list).toContainText(POST_SEGUIDO);
    await expect(page.locator("main")).not.toContainText(POST_ESTRANHO);
    await noHorizontalScroll(page);
    await shot(page, "timeline-seguindo-390");

    // e o compositor aparece no topo do seguindo
    await expect(page.getByTestId("post-composer")).toBeVisible();
    // a aba tudo continua com os dois posts
    await page.getByTestId("feed-tab-tudo").click();
    await expect(page.getByTestId("timeline-posts")).toContainText(POST_ESTRANHO);
  });

  test("ao vivo: sem edição rolando, o vazio manda pro radar", async ({ memberPage: page }) => {
    const db = openE2eDb();
    // outras specs deixam edições rolando no banco do e2e: desliga na hora do
    // teste e religa em seguida (o e2e roda serializado, ninguém vê no meio)
    const live = await liveEditionIds();
    const ids = `{${live.join(",")}}`;
    if (live.length > 0) await db.prepare("UPDATE hackathons SET active = 0 WHERE id = ANY(?::text[])").run(ids);
    try {
      await page.setViewportSize({ width: 390, height: 900 });
      await page.goto("/feed?aba=ao-vivo");
      const empty = page.getByTestId("feed-live-empty");
      await expect(empty).toContainText("Nenhum hackathon rolando agora.");
      await expect(empty.getByRole("link", { name: "Ver hackathons" })).toHaveAttribute("href", "/radar");
      await expect(page.getByTestId("post-composer")).toHaveCount(0);
      await noHorizontalScroll(page);
      await shot(page, "timeline-ao-vivo-vazio-390");
    } finally {
      if (live.length > 0) await db.prepare("UPDATE hackathons SET active = 1 WHERE id = ANY(?::text[])").run(ids);
    }
  });

  test("ao vivo: a edição que roda agora entra com o mural dela", async ({ memberPage: page }) => {
    const db = openE2eDb();
    const estranho = (await idOf(ESTRANHO))!;
    const start = new Date(Date.now() - 3_600_000).toISOString();
    const end = new Date(Date.now() + 3_600_000).toISOString();
    await db
      .prepare(
        `INSERT INTO hackathons (id, name, organizer, startsAt, endsAt, format, registrationUrl, tags, active, source)
         VALUES (?, 'E2E Timeline Ao Vivo', 'E2E', ?, ?, 'online', '', '[]', 1, 'painel')`,
      )
      .run(LIVE, start, end);
    await db.prepare("INSERT INTO posts (memberId, body, hackathonId) VALUES (?, ?, ?)").run(estranho, POST_LIVE, LIVE);

    for (const vw of [1280, 390]) {
      await page.setViewportSize({ width: vw, height: 900 });
      await page.goto("/feed?aba=ao-vivo");
      const live = page.getByTestId("feed-live-editions");
      await expect(live).toContainText("E2E Timeline Ao Vivo");
      await expect(live.getByRole("link", { name: /E2E Timeline Ao Vivo/ })).toHaveAttribute("href", `/h/${LIVE}`);
      await expect(page.getByTestId("timeline-posts")).toContainText(POST_LIVE);
      await noHorizontalScroll(page);
      await shot(page, `timeline-ao-vivo-${vw === 390 ? "390" : "desktop"}`);
    }
  });

  test("cursor: 75 posts chegam todos no 'carregar mais'", async ({ memberPage: page }) => {
    const db = openE2eDb();
    const estranho = (await idOf(ESTRANHO))!;
    const corpo = Array.from({ length: 75 }, (_, i) => `${MARK} pagina ${String(i).padStart(2, "0")}`);
    for (const body of corpo) await db.prepare("INSERT INTO posts (memberId, body) VALUES (?, ?)").run(estranho, body);

    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/feed?aba=tudo");
    const list = page.getByTestId("timeline-posts");
    const cards = list.getByTestId("post-card");
    await expect(cards).toHaveCount(20);
    const mais = page.getByTestId("timeline-more");
    for (let i = 0; i < 10; i++) {
      if ((await mais.count()) === 0) break;
      const antes = await cards.count();
      await mais.click();
      // a página nova chega por cursor: a lista cresce (e o botão some no fim)
      await expect.poll(() => cards.count()).toBeGreaterThan(antes);
    }
    // os 75 posts do teste estão todos na lista
    for (const marker of [`${MARK} pagina 74`, `${MARK} pagina 00`]) {
      await expect(list).toContainText(marker);
    }
    const total = await list.locator(`li:has-text("${MARK} pagina ")`).count();
    expect(total).toBe(75);
    await noHorizontalScroll(page);
    await shot(page, "timeline-carregar-mais-390");
  });

  test("menu: feed e buscar no desktop e no mobile", async ({ memberPage: page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/feed");
    const desktop = page.getByRole("navigation", { name: "Navegação principal" });
    await expect(desktop.getByRole("link", { name: "feed" })).toHaveAttribute("href", "/feed");
    await expect(desktop.getByRole("link", { name: "buscar" })).toHaveAttribute("href", "/busca");
    await expect(desktop.getByRole("link", { name: "feed" })).toHaveAttribute("aria-current", "page");
    // feed é a primeira porta
    await expect(desktop.getByRole("link").first()).toHaveText("feed");
    await noHorizontalScroll(page);
    await shot(page, "timeline-menu-desktop");

    // oito portas no desktop: em 1024px o header não pode estourar a tela
    await page.setViewportSize({ width: 1024, height: 900 });
    await noHorizontalScroll(page);
    await expect(desktop.getByRole("link", { name: "buscar" })).toBeVisible();

    await page.setViewportSize({ width: 390, height: 900 });
    await page.getByRole("button", { name: "menu" }).click();
    const mobile = page.getByRole("navigation", { name: "Navegação principal (menu)" });
    await expect(mobile.getByRole("link", { name: "feed" })).toHaveAttribute("href", "/feed");
    await expect(mobile.getByRole("link", { name: "buscar" })).toHaveAttribute("href", "/busca");
    await noHorizontalScroll(page);
    await shot(page, "timeline-menu-390");
  });

  test("painel: os 5 primeiros do seguindo com 'ver timeline'", async ({ memberPage: page }) => {
    const db = openE2eDb();
    const seguido = (await idOf(SEGUIDO))!;
    for (let i = 0; i < 6; i++) {
      await db.prepare("INSERT INTO posts (memberId, body) VALUES (?, ?)").run(seguido, `${MARK} painel ${i}`);
    }
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/dashboard");
    const box = page.getByTestId("dashboard-timeline");
    await expect(box).toContainText("Sua timeline");
    await expect(box.getByRole("link", { name: /ver timeline/ })).toHaveAttribute("href", "/feed");
    // cinco, não vinte: o painel é resumo
    await expect(box.getByTestId("post-card")).toHaveCount(5);
    await expect(box).toContainText(`${MARK} painel 5`);
    await expect(box).not.toContainText(POST_SEGUIDO);
    await noHorizontalScroll(page);
    await shot(page, "timeline-painel-390");
  });
});
