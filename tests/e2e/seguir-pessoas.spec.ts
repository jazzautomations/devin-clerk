import { expect, type Page } from "@playwright/test";
import { E2E_MEMBER_EMAIL, test } from "./auth";
import { openE2eDb } from "./db";

// Seguir pessoa (migration 033): seguir pelo /u, ver em /perfil/seguindo,
// "segue você" e o time em comum pra quem visita (sem número), os números só
// no próprio perfil, deixar de seguir sem notificar de novo, /membros sem
// pódio e sem quem bloqueou. Tudo também em 390px.

const SHOTS = process.env.E2E_SHOT_DIR;
const ALVO = "e2e_seg_alvo"; // fez time com o membro e2e e segue ele
const BLOQ = "e2e_seg_bloq"; // bloqueou o membro e2e: some do /membros
const PEOPLE = [ALVO, BLOQ];
const HACK = "hack-inova-unifacens-2026";
const TEAM = "E2E Seguir Time";

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
async function follows(a: number, b: number) {
  return !!(await openE2eDb().prepare(`SELECT 1 AS ok FROM member_follows WHERE "memberId" = ? AND "followedId" = ?`).get(a, b));
}
async function followNotifs(to: number) {
  const r = await openE2eDb()
    .prepare(`SELECT COUNT(*)::int AS n FROM notifications WHERE "memberId" = ? AND type = 'follow'`)
    .get<{ n: number }>(to);
  return Number(r?.n ?? 0);
}

async function cleanup() {
  const db = openE2eDb();
  const meId = (await me()).id;
  const ids = (await Promise.all(PEOPLE.map(idOf))).filter((x): x is number => x !== null);
  const all = `{${[meId, ...ids].join(",")}}`;
  await db.prepare(`DELETE FROM member_follows WHERE "memberId" = ANY(?::int[]) OR "followedId" = ANY(?::int[])`).run(all, all);
  await db.prepare(`DELETE FROM member_blocks WHERE "memberId" = ANY(?::int[]) OR "blockedId" = ANY(?::int[])`).run(all, all);
  await db.prepare(`DELETE FROM notifications WHERE type = 'follow' AND ("memberId" = ANY(?::int[]) OR "actorId" = ANY(?::int[]))`).run(all, all);
  const t = await db.prepare("SELECT id FROM teams WHERE \"hackathonId\" = ? AND name = ?").get<{ id: number }>(HACK, TEAM);
  if (t) {
    await db.prepare(`DELETE FROM team_members WHERE "teamId" = ?`).run(t.id);
    await db.prepare("DELETE FROM teams WHERE id = ?").run(t.id);
  }
  for (const id of ids) {
    await db.prepare(`DELETE FROM notifications WHERE "memberId" = ?`).run(id);
    await db.prepare("DELETE FROM members WHERE id = ?").run(id);
  }
}

async function seed() {
  const db = openE2eDb();
  const eu = await me();
  const person = async (username: string, name: string, headline: string, xp: number) =>
    (await db
      .prepare(`INSERT INTO members ("clerkId", username, email, name, headline, xp) VALUES (?, ?, ?, ?, ?, ?) RETURNING id`)
      .get<{ id: number }>(`clerk_${username}`, username, `${username}@t.dev`, name, headline, xp))!.id;
  const alvo = await person(ALVO, "Alvo Seguir", "front e acessibilidade", 99999);
  const bloq = await person(BLOQ, "Quem Bloqueou", "não quer papo", 99998);
  // o alvo já segue o membro e2e: o /u dele mostra "segue você"
  await db.prepare(`INSERT INTO member_follows ("memberId", "followedId") VALUES (?, ?)`).run(alvo, eu.id);
  await db.prepare(`INSERT INTO member_blocks ("memberId", "blockedId") VALUES (?, ?)`).run(bloq, eu.id);
  const t = await db
    .prepare(`INSERT INTO teams ("hackathonId", name) VALUES (?, ?) RETURNING id`)
    .get<{ id: number }>(HACK, TEAM);
  await db.prepare(`INSERT INTO team_members ("teamId", username) VALUES (?, ?), (?, ?)`).run(t!.id, eu.username, t!.id, ALVO);
}

test.describe.configure({ mode: "serial" });

test.describe("seguir pessoas", () => {
  test.beforeAll(async () => {
    await cleanup();
    await seed();
  });
  test.afterAll(cleanup);

  test("anon: API dá 401 e /perfil/seguidores vai pro cadastro", async ({ request }) => {
    const r = await request.post(`/api/members/${ALVO}/follow`);
    expect(r.status()).toBe(401);
    expect(await r.json()).toEqual({ error: "Unauthorized" });
    expect((await request.delete(`/api/members/${ALVO}/follow`)).status()).toBe(401);
    for (const p of ["/perfil/seguidores", "/perfil/seguindo"]) {
      const res = await request.get(p, { maxRedirects: 0 });
      expect(res.status()).toBe(307);
      expect(res.headers()["location"]).toContain(`/sign-up?redirect_url=${encodeURIComponent(p)}`);
    }
    // perfil aberto pra anon: nenhum número de seguidor
    const card = await request.get(`/u/${ALVO}`);
    expect(await card.text()).not.toMatch(/seguidor|seguindo/);
  });

  test("segue pelo perfil: 'segue você', o time em comum e nenhum número", async ({ memberPage: page }) => {
    const hackName = (await openE2eDb().prepare("SELECT name FROM hackathons WHERE id = ?").get<{ name: string }>(HACK))!.name;
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/u/${ALVO}`);
    const box = page.getByTestId("profile-follow");
    await expect(box.getByTestId("follows-you")).toHaveText("segue você");
    await expect(box.getByTestId("same-team")).toHaveText(`vocês fizeram time no ${hackName}`);
    await expect(page.locator("main")).not.toContainText(/seguidor/);
    await expect(page.getByTestId("own-follow-counts")).toHaveCount(0);
    const btn = box.getByTestId("follow-button");
    await expect(btn).toHaveText("seguir");
    await expect(btn).toHaveAttribute("aria-pressed", "false");
    expect((await btn.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await noHorizontalScroll(page);
    await shot(page, "seguir-perfil-390");

    await btn.click();
    await expect(btn).toHaveAttribute("aria-pressed", "true");
    await expect(btn).toHaveText(/seguindo|deixar de seguir/);
    const eu = await me();
    const alvo = (await idOf(ALVO))!;
    await expect.poll(() => follows(eu.id, alvo)).toBe(true);
    expect(await followNotifs(alvo)).toBe(1);
    // passar o mouse mostra o que o clique faz
    await page.mouse.move(0, 0);
    await expect(btn).toHaveText("seguindo");
    await btn.hover();
    await expect(btn).toHaveText("deixar de seguir");

    await page.reload();
    await expect(page.getByTestId("profile-follow").getByTestId("follow-button")).toHaveAttribute("aria-pressed", "true");
  });

  test("vê quem segue em /perfil/seguindo e o número só no próprio perfil", async ({ memberPage: page }) => {
    const eu = await me();
    for (const vw of [1280, 390]) {
      await page.setViewportSize({ width: vw, height: 900 });
      await page.goto(`/u/${eu.username}`);
      const counts = page.getByTestId("own-follow-counts");
      await expect(counts).toContainText("1 seguidor");
      await expect(counts).toContainText("1 seguindo");
      await expect(page.getByTestId("profile-follow")).toHaveCount(0);
      await noHorizontalScroll(page);
      await counts.getByRole("link", { name: "1 seguindo" }).click();
      await expect(page).toHaveURL(/\/perfil\/seguindo$/);
      const list = page.getByTestId("following-list");
      await expect(list).toContainText("Alvo Seguir");
      await expect(list).toContainText(`@${ALVO}`);
      await expect(list).toContainText("front e acessibilidade");
      await expect(list.getByTestId("follow-button")).toHaveAttribute("aria-pressed", "true");
      await noHorizontalScroll(page);
      await shot(page, `seguindo-${vw === 390 ? "390" : "desktop"}`);

      await page.getByRole("navigation", { name: "seguir" }).getByRole("link", { name: /seguidores/ }).click();
      await expect(page).toHaveURL(/\/perfil\/seguidores$/);
      await expect(page.getByTestId("followers-list")).toContainText("Alvo Seguir");
      await noHorizontalScroll(page);
    }
  });

  test("deixa de seguir na lista e seguir de novo não notifica outra vez", async ({ memberPage: page }) => {
    const eu = await me();
    const alvo = (await idOf(ALVO))!;
    await page.goto("/perfil/seguindo");
    const btn = page.getByTestId("following-list").getByTestId("follow-button");
    await btn.click();
    await expect(btn).toHaveAttribute("aria-pressed", "false");
    await expect(btn).toHaveText("seguir");
    await expect.poll(() => follows(eu.id, alvo)).toBe(false);

    // vazio: sugere quem fez time
    await page.reload();
    await expect(page.getByTestId("following-empty")).toHaveText("Você ainda não segue ninguém. Comece por quem fez time com você.");
    const sug = page.getByTestId("following-teammates");
    await expect(sug).toContainText("Alvo Seguir");
    await sug.getByTestId(`follow-${ALVO}`).getByTestId("follow-button").click();
    await expect(sug.getByTestId(`follow-${ALVO}`).getByTestId("follow-button")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => follows(eu.id, alvo)).toBe(true);
    expect(await followNotifs(alvo)).toBe(1);
  });

  test("/membros: botão em cada linha menos na própria, sem pódio e sem quem bloqueou", async ({ memberPage: page }) => {
    const eu = await me();
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/membros");
    await expect(page.locator("[data-rank]")).toHaveCount(0);
    const alvoRow = page.locator("main li").filter({ has: page.locator(`a[href="/u/${ALVO}"]`) });
    await expect(alvoRow.getByTestId("follow-button")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(`main a[href="/u/${BLOQ}"]`)).toHaveCount(0);
    await noHorizontalScroll(page);
    await shot(page, "membros-390");
    await page.goto(`/membros?q=${encodeURIComponent(eu.username)}`);
    const own = page.locator("main li").filter({ has: page.locator(`a[href="/u/${eu.username}"]`) });
    await expect(own).toHaveCount(1);
    await expect(own.getByTestId("follow-button")).toHaveCount(0);
  });

  test("bloquear desfaz o seguir e a API passa a dar 404", async ({ memberPage: page }) => {
    const eu = await me();
    const alvo = (await idOf(ALVO))!;
    expect(await follows(eu.id, alvo)).toBe(true);
    await page.goto(`/u/${ALVO}`);
    await page.getByTestId("profile-safety-toggle").click();
    await page.getByTestId("safety-block").click();
    await page.getByTestId("block-confirm-yes").click();
    await expect(page.getByTestId("profile-blocked-note")).toBeVisible();
    await expect(page.getByTestId("profile-follow")).toHaveCount(0);
    expect(await follows(eu.id, alvo)).toBe(false);
    expect(await follows(alvo, eu.id)).toBe(false);
    const r = await page.request.post(`/api/members/${ALVO}/follow`);
    expect(r.status()).toBe(404);
  });
});
