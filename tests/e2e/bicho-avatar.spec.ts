import { expect, type Page } from "@playwright/test";
import { E2E_MEMBER_EMAIL, test } from "./auth";
import { openE2eDb } from "./db";

// Bicho como avatar e evolução (spec 046, onda 4, migration 047). O membro
// e2e entra sem foto real no Clerk, então nasce com o bicho; aqui ele troca
// pra foto, volta pro bicho e confere que o avatar aparece no feed, em
// /membros e no perfil — em 390px, sem scroll horizontal.

const POST = "post e2e — o bicho como avatar";
const BICHO_SRC = /\/api\/mascote\/m\/\d+\?e=(filhote|jovem|adulto)(&i=[a-z,]+)?&v=[0-9a-z]+$/;

async function me() {
  return (await openE2eDb()
    .prepare("SELECT id, username FROM members WHERE email = ?")
    .get<{ id: number; username: string }>(E2E_MEMBER_EMAIL))!;
}

async function seedPost() {
  const db = openE2eDb();
  const eu = await me();
  const has = await db.prepare("SELECT 1 FROM posts WHERE body = ?").get(POST);
  if (!has) await db.prepare("INSERT INTO posts (memberId, body) VALUES (?, ?)").run(eu.id, POST);
}

async function avatarRow() {
  return (await openE2eDb()
    .prepare(`SELECT avatarKind, avatarUrl FROM members WHERE email = ?`)
    .get<{ avatarKind: string; avatarUrl: string | null }>(E2E_MEMBER_EMAIL))!;
}

/** devolve o membro e2e pro estado neutro: foto, sem itens escolhidos */
async function voltarPraFoto() {
  await openE2eDb()
    .prepare(
      `UPDATE members SET avatarKind = 'foto', avatarUrl = clerkImageUrl, mascoteItens = NULL WHERE email = ?`,
    )
    .run(E2E_MEMBER_EMAIL);
}

async function semScroll(page: Page, onde: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `scroll horizontal em ${onde}`).toBeLessThanOrEqual(0);
}

/** tira do banco o post do teste: outros specs contam com o feed do membro e2e vazio */
async function limparPost() {
  await openE2eDb().prepare("DELETE FROM posts WHERE body = ?").run(POST);
}

test.describe.configure({ mode: "serial" });

test.describe("bicho como avatar", () => {
  test.beforeAll(async () => {
    await seedPost();
    await voltarPraFoto();
  });
  test.afterAll(async () => {
    await limparPost();
    await voltarPraFoto();
  });

  test("trocar pra bicho muda o avatar em todo lugar", async ({ memberPage: page }) => {
    await seedPost();
    await page.goto("/perfil");
    const toggle = page.getByTestId("avatar-toggle");
    await expect(toggle).toBeVisible();
    await page.getByTestId("avatar-op-bicho").click();
    await expect(page.getByTestId("avatar-estado")).toHaveText("salvo");
    await expect(toggle.locator('img[data-avatar="bicho"]')).toBeVisible();

    const salvo = await avatarRow();
    expect(salvo.avatarKind).toBe("bicho");
    expect(salvo.avatarUrl).toMatch(BICHO_SRC);

    // feed: o post do membro mostra o bicho
    await page.goto("/feed");
    const post = page.locator("li", { hasText: POST }).first();
    await expect(post).toBeVisible();
    const noFeed = post.locator('img[data-avatar="bicho"]');
    await expect(noFeed).toHaveCount(1);
    const src = await noFeed.getAttribute("src");
    expect(src).toMatch(BICHO_SRC);
    // o SVG do bicho carregou de verdade (nada de imagem quebrada)
    await expect
      .poll(async () => noFeed.evaluate((img) => (img as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);

    // /membros: a mesma pessoa aparece com o bicho
    const eu = await me();
    await page.goto(`/membros?q=${eu.username}`);
    const linha = page.locator("li", { hasText: `@${eu.username}` }).first();
    await expect(linha.locator('img[data-avatar="bicho"]')).toHaveCount(1);
  });

  test("voltar pra foto tira o bicho do feed", async ({ memberPage: page }) => {
    await seedPost();
    await voltarPraFoto();
    await page.goto("/perfil");
    await page.getByTestId("avatar-op-bicho").click();
    await expect(page.getByTestId("avatar-estado")).toHaveText("salvo");
    await page.getByTestId("avatar-op-foto").click();
    await expect(page.getByTestId("avatar-estado")).toHaveText("salvo");
    expect((await avatarRow()).avatarKind).toBe("foto");

    await page.goto("/feed");
    const post = page.locator("li", { hasText: POST }).first();
    await expect(post).toBeVisible();
    await expect(post.locator('img[data-avatar="bicho"]')).toHaveCount(0);
  });

  test("/u mostra o bicho grande com estágio e semanas", async ({ memberPage: page }) => {
    await seedPost();
    const eu = await me();
    await page.goto(`/u/${eu.username}`);
    const bicho = page.getByTestId("u-bicho");
    await expect(bicho).toBeVisible();
    await expect(page.getByTestId("u-bicho-estagio")).toContainText(/filhote|jovem|adulto/);
    // o viewer desenhou o bicho (SVG isométrico ou o 3D, quando há WebGL)
    await expect(bicho.locator("img, canvas").first()).toBeVisible();
  });

  test("itens do bicho: o travado mostra o que destrava", async ({ memberPage: page }) => {
    await page.goto("/perfil/bicho");
    await page.getByTestId("mascote-aba-itens").click();
    await expect(page.getByTestId("mascote-itens-resumo")).toBeVisible();
    // o membro e2e não tem fato verificado: tudo travado, com o "como ganhar"
    const cracha = page.getByTestId("mascote-item-cracha");
    await expect(cracha).toBeVisible();
    await expect(cracha).toHaveAttribute("data-unlocked", "0");
    await expect(cracha).toContainText(/check-in/);
    await expect(cracha).toBeDisabled();
  });

  test("390px: perfil, perfil/bicho e /u sem scroll horizontal", async ({ memberPage: page }) => {
    const eu = await me();
    await page.setViewportSize({ width: 390, height: 844 });
    for (const [rota, onde] of [
      ["/perfil", "perfil"],
      ["/perfil/bicho", "perfil/bicho"],
      [`/u/${eu.username}`, "/u"],
      ["/feed", "feed"],
    ] as const) {
      await page.goto(rota);
      await semScroll(page, onde);
    }
  });
});
