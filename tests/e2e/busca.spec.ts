import { expect, type Page } from "@playwright/test";
import { E2E_MEMBER_EMAIL, memberRequest, test } from "./auth";
import { openE2eDb } from "./db";

// Busca global (migration 042): /busca logada, seções por tipo com
// "ver todos" e "mais", estado vazio, termo curto, comunidade escondida e
// pessoa bloqueada fora, post como trecho com link pro /post. Tudo em 390px.

const SHOTS = process.env.E2E_SHOT_DIR;
const PESSOA = "e2e_busca_carimbo";
const BLOQ = "e2e_busca_bloq";
const H = "e2e-busca-h";
const SLUG = "e2e-busca-";
const LOTE = 22; // + a comunidade aberta = 23: 5 na visão geral, 20 + 3 no tipo

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "scroll horizontal").toBeLessThanOrEqual(0);
}
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}
async function me() {
  const r = await openE2eDb().prepare("SELECT id FROM members WHERE email = ?").get<{ id: number }>(E2E_MEMBER_EMAIL);
  return r!.id;
}

async function cleanup() {
  const db = openE2eDb();
  const ids = (
    await db.prepare("SELECT id FROM members WHERE username IN (?, ?)").all<{ id: number }>(PESSOA, BLOQ)
  ).map((r) => r.id);
  const arr = `{${ids.join(",")}}`;
  await db.prepare(`DELETE FROM member_blocks WHERE "memberId" = ANY(?::int[]) OR "blockedId" = ANY(?::int[])`).run(arr, arr);
  await db.prepare(`DELETE FROM posts WHERE "memberId" = ANY(?::int[])`).run(arr);
  await db.prepare(`DELETE FROM team_projects WHERE "teamId" IN (SELECT id FROM teams WHERE "hackathonId" = ?)`).run(H);
  await db.prepare(`DELETE FROM teams WHERE "hackathonId" = ?`).run(H);
  await db.prepare("DELETE FROM hackathons WHERE id = ?").run(H);
  await db.prepare("DELETE FROM communities WHERE slug LIKE ?").run(`${SLUG}%`);
  await db.prepare("DELETE FROM members WHERE id = ANY(?::int[])").run(arr);
}

let postId = 0;
async function seed() {
  const db = openE2eDb();
  const person = async (username: string, name: string, headline: string) =>
    (await db
      .prepare(`INSERT INTO members ("clerkId", username, email, name, headline) VALUES (?, ?, ?, ?, ?) RETURNING id`)
      .get<{ id: number }>(`clerk_${username}`, username, `${username}@t.dev`, name, headline))!.id;
  const pessoa = await person(PESSOA, "Carimbó da Silva", "toca carimbó e faz app");
  const bloq = await person(BLOQ, "Carimbó Bloqueado", "não deve aparecer");
  await db.prepare(`INSERT INTO member_blocks ("memberId", "blockedId") VALUES (?, ?)`).run(await me(), bloq);

  await db
    .prepare(`INSERT INTO communities (slug, name, city, description) VALUES (?, 'Carimbó Paraense', 'Belém, PA', 'Roda de carimbó e código.')`)
    .run(`${SLUG}aberta`);
  await db
    .prepare(`INSERT INTO communities (slug, name, description, hidden) VALUES (?, 'Carimbó Escondido', 'escondida pela moderação', 1)`)
    .run(`${SLUG}escondida`);
  for (let i = 0; i < LOTE; i++) {
    await db.prepare(`INSERT INTO communities (slug, name, description) VALUES (?, ?, 'lote de carimbó')`).run(`${SLUG}lote-${i}`, `Lote ${i}`);
  }

  // evento externo que já acabou: fica fora do radar e dos outros specs
  await db
    .prepare(
      `INSERT INTO hackathons (id, name, organizer, "startsAt", "endsAt", format, location, "registrationUrl", active)
       VALUES (?, 'Festival do Carimbó Hack', 'Coletivo E2E', '2025-01-10 09:00:00', '2025-01-11 18:00:00', 'presencial', 'Belém, PA', 'https://exemplo.dev/carimbo', 1)`,
    )
    .run(H);
  const t = await db.prepare(`INSERT INTO teams ("hackathonId", name) VALUES (?, 'Time Busca E2E') RETURNING id`).get<{ id: number }>(H);
  await db
    .prepare(`INSERT INTO team_projects ("teamId", title, tagline, description) VALUES (?, 'Mapa da Roda', 'onde tem carimbó hoje', 'mapa colaborativo')`)
    .run(t!.id);

  const body = `${"Bom dia, gente! ".repeat(12)}Alguém topa montar um time pra fazer um app de carimbó no próximo hackathon? ${"Valeu demais. ".repeat(12)}`;
  postId = (await db.prepare(`INSERT INTO posts ("memberId", body) VALUES (?, ?) RETURNING id`).get<{ id: number }>(pessoa, body))!.id;
  await db.prepare(`INSERT INTO posts ("memberId", body) VALUES (?, 'carimbó de quem eu bloqueei')`).run(bloq);
}

test.describe.configure({ mode: "serial" });

test.describe("busca global", () => {
  test.beforeAll(async () => {
    await cleanup();
    await seed();
  });
  test.afterAll(cleanup);

  test("anon: /api/search dá 401 e /busca pede conta", async ({ page, request }) => {
    expect((await request.get("/api/search?q=carimbo")).status()).toBe(401);
    await page.goto("/busca?q=carimbo");
    await expect(page).toHaveURL(/\/sign-up/);
  });

  test("busca em tudo: 5 por seção, sem escondido nem bloqueado (390px e desktop)", async ({ memberPage: page }) => {
    for (const vw of [390, 1280]) {
      await page.setViewportSize({ width: vw, height: 900 });
      await page.goto("/busca");
      await expect(page.getByRole("heading", { level: 1, name: "Buscar" })).toBeVisible();
      await noHorizontalScroll(page);
      await page.getByTestId("busca-campo").fill("carimbó");
      await page.getByTestId("busca-campo").press("Enter");
      await expect(page).toHaveURL(/\/busca\?q=carimb/);

      const pessoas = page.getByTestId("busca-secao-pessoas");
      await expect(pessoas).toContainText("Carimbó da Silva");
      await expect(pessoas).not.toContainText("Carimbó Bloqueado");
      await expect(page.getByTestId("busca-secao-projetos")).toContainText("Mapa da Roda");
      await expect(page.getByTestId("busca-secao-hackathons")).toContainText("Festival do Carimbó Hack");

      const comunidades = page.getByTestId("busca-secao-comunidades");
      await expect(comunidades.getByRole("listitem")).toHaveCount(5);
      await expect(comunidades).not.toContainText("Carimbó Escondido");

      const post = page.getByTestId("busca-post");
      await expect(post).toHaveCount(1);
      await expect(post).toHaveAttribute("href", `/post/${postId}`);
      await expect(post).toContainText("carimbó");
      const excerpt = (await post.getByTestId("busca-trecho").innerText()).trim();
      expect([...excerpt].length).toBeLessThanOrEqual(160);
      await expect(page.locator("body")).not.toContainText("carimbó de quem eu bloqueei");

      await noHorizontalScroll(page);
      await shot(page, `busca-tudo-${vw === 390 ? "390" : "desktop"}`);
    }
  });

  test("ver todos abre o tipo com 20 e mais traz o resto", async ({ memberPage: page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/busca?q=${encodeURIComponent("carimbó")}`);
    await page.getByTestId("busca-secao-comunidades").getByRole("link", { name: "ver todos →" }).click();
    await expect(page).toHaveURL(/tipo=comunidades/);
    const secao = page.getByTestId("busca-secao-comunidades");
    await expect(secao.getByRole("listitem")).toHaveCount(20);
    await expect(page.getByTestId("busca-secao-pessoas")).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "tipo de resultado" }).getByRole("link", { name: "comunidades", exact: true })).toHaveAttribute("aria-current", "page");
    await noHorizontalScroll(page);
    await page.getByTestId("busca-mais").click();
    await expect(page).toHaveURL(/antes=/);
    await expect(page.getByTestId("busca-secao-comunidades").getByRole("listitem")).toHaveCount(LOTE + 1 - 20);
    await expect(page.getByTestId("busca-mais")).toHaveCount(0);
    // o campo mantém o tipo: buscar de novo continua em comunidades
    await page.getByTestId("busca-campo").fill("paraense");
    await page.getByTestId("busca-campo").press("Enter");
    await expect(page).toHaveURL(/tipo=comunidades/);
    await expect(page.getByTestId("busca-secao-comunidades")).toContainText("Carimbó Paraense");
    await noHorizontalScroll(page);
    await shot(page, "busca-tipo-390");
  });

  test("vazio aponta o /radar; termo de 1 letra avisa", async ({ memberPage: page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/busca?q=xqzwvkjh");
    const vazio = page.getByTestId("busca-vazio");
    await expect(vazio).toHaveText("Nada com 'xqzwvkjh'. Tente outra palavra ou veja o /radar.");
    await expect(vazio.getByRole("link", { name: "/radar" })).toHaveAttribute("href", "/radar");
    await noHorizontalScroll(page);
    await shot(page, "busca-vazio-390");

    await page.goto("/busca?q=a");
    await expect(page.getByTestId("busca-aviso")).toHaveText("Digite pelo menos 2 letras.");
    await expect(page.getByTestId("busca-vazio")).toHaveCount(0);
  });

  test("API logada: 400 com 1 letra, pessoa pelo começo do @", async ({ memberPage: page }) => {
    const request = await memberRequest(page);
    expect((await request.get("/api/search?q=a")).status()).toBe(400);
    expect((await request.get("/api/search?q=carimbo&tipo=grupos")).status()).toBe(400);
    const res = await request.get(`/api/search?q=${encodeURIComponent("@e2e_busca_car")}&tipo=pessoas`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    const names = body.sections.pessoas.items.map((p: { username: string }) => p.username);
    expect(names).toContain(PESSOA);
    expect(names).not.toContain(BLOQ);
  });
});
