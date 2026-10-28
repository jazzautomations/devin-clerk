import { expect, type Page } from "@playwright/test";
import { E2E_MEMBER_EMAIL, memberRequest, test } from "./auth";
import { openE2eDb } from "./db";

// Seguir comunidade (migration 030): membro = segue; o seguir leve é pra
// quem acompanha sem entrar. Botão na lista e na página, aba "minhas
// comunidades" no /feed (padrão de quem segue, paginada), novidades no
// painel e o anúncio de hackathon publicado chegando em quem só segue.
// Tudo também em 390px.

const SHOTS = process.env.E2E_SHOT_DIR;
const SEG = "e2e-seguir-floripa"; // a comunidade que o membro e2e segue
const DONA = "e2e-seguir-dona"; // a que o membro e2e é dono e publica hackathon
const HACK = "e2e-seguir-hack-2027";
const AUTOR = "clerk_e2e_seguir_autor";
const FAN = "clerk_e2e_seguir_fan";

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "scroll horizontal").toBeLessThanOrEqual(0);
}
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function cleanup() {
  const db = openE2eDb();
  const hs = await db
    .prepare(`SELECT h.id FROM hackathons h JOIN communities c ON c.id = h."communityId" WHERE c.slug = ANY(?::text[])`)
    .all<{ id: string }>(`{${SEG},${DONA}}`);
  for (const h of hs) {
    await db.prepare(`DELETE FROM deliveries WHERE "announcementId" IN (SELECT id FROM announcements WHERE "hackathonId" = ?)`).run(h.id);
    for (const t of ["announcements", "edition_roles", "cards"]) {
      await db.prepare(`DELETE FROM ${t} WHERE "hackathonId" = ?`).run(h.id);
    }
    await db.prepare("DELETE FROM notifications WHERE href = ?").run(`/h/${h.id}`);
    await db.prepare("DELETE FROM hackathons WHERE id = ?").run(h.id);
  }
  for (const slug of [SEG, DONA]) {
    const c = await db.prepare("SELECT id FROM communities WHERE slug = ?").get<{ id: number }>(slug);
    if (!c) continue;
    await db.prepare(`DELETE FROM posts WHERE "communityId" = ?`).run(c.id);
    await db.prepare(`DELETE FROM community_notices WHERE "communityId" = ?`).run(c.id);
    await db.prepare("DELETE FROM communities WHERE id = ?").run(c.id);
  }
  for (const clerkId of [AUTOR, FAN]) {
    const m = await db.prepare(`SELECT id FROM members WHERE "clerkId" = ?`).get<{ id: number }>(clerkId);
    if (!m) continue;
    await db.prepare(`DELETE FROM notifications WHERE "memberId" = ?`).run(m.id);
    await db.prepare(`DELETE FROM community_follows WHERE "memberId" = ?`).run(m.id);
    await db.prepare(`DELETE FROM community_members WHERE "memberId" = ?`).run(m.id);
    await db.prepare("DELETE FROM members WHERE id = ?").run(m.id);
  }
}

async function me() {
  const r = await openE2eDb().prepare("SELECT id FROM members WHERE email = ?").get<{ id: number }>(E2E_MEMBER_EMAIL);
  return r!.id;
}

/** comunidade de outra cidade, com autor próprio: mural, aviso e hackathon publicado */
async function seed() {
  const db = openE2eDb();
  const autor = await db
    .prepare(`INSERT INTO members ("clerkId", username, email, name) VALUES (?, 'e2e-seguir-autor', 'e2e-seguir-autor@t.dev', 'Autora Floripa') RETURNING id`)
    .get<{ id: number }>(AUTOR);
  const c = await db
    .prepare(`INSERT INTO communities (slug, name, city, description) VALUES (?, 'E2E Hack Floripa', 'Florianópolis, SC', 'Comunidade de teste do seguir.') RETURNING id`)
    .get<{ id: number }>(SEG);
  await db.prepare(`INSERT INTO community_members ("communityId", "memberId", role) VALUES (?, ?, 'dono')`).run(c!.id, autor!.id);
  // 24 posts antigos (pra paginar) + o aviso e o hackathon mais novos
  for (let i = 0; i < 24; i++) {
    await db
      .prepare(`INSERT INTO posts ("memberId", body, "communityId", "createdAt") VALUES (?, ?, ?, ?)`)
      .run(autor!.id, `post antigo ${i}`, c!.id, `2026-08-${String(1 + i).padStart(2, "0")} 12:00:00`);
  }
  await db
    .prepare(`INSERT INTO posts ("memberId", body, "communityId", "createdAt") VALUES (?, 'Demo do time da UFSC no mural', ?, '2026-10-20 12:00:00')`)
    .run(autor!.id, c!.id);
  await db
    .prepare(`INSERT INTO community_notices ("communityId", title, body, "createdBy", "createdAt") VALUES (?, 'Encontro no sábado', 'Às 14h na UFSC.', ?, '2026-10-21 12:00:00')`)
    .run(c!.id, autor!.id);
  await db
    .prepare(
      `INSERT INTO hackathons (id, name, organizer, "startsAt", format, "registrationUrl", tags, active, source, "communityId", "publishedAt", location)
       VALUES ('e2e-seguir-floripa-h', 'E2E Hack Ilha', 'E2E Hack Floripa', '2027-05-08T09:00:00-03:00', 'presencial', '', '[]', 1, 'painel', ?, '2026-10-22 12:00:00', 'Florianópolis, SC')`,
    )
    .run(c!.id);
}

test.describe.configure({ mode: "serial" });

test.describe("seguir comunidade", () => {
  test.beforeAll(async () => {
    await cleanup();
    await seed();
  });
  test.afterAll(cleanup);

  test("anon não segue (401)", async ({ request }) => {
    expect((await request.post(`/api/communities/${SEG}/follow`)).status()).toBe(401);
    expect((await request.delete(`/api/communities/${SEG}/follow`)).status()).toBe(401);
  });

  test("sem seguir nada: /feed abre no 'tudo' e a aba de comunidades explica o que fazer", async ({ memberPage: page }) => {
    // o membro e2e não está em nenhuma comunidade aqui (as outras specs limpam)
    await page.goto("/feed");
    const tabs = page.getByTestId("feed-tabs");
    await expect(tabs).toBeVisible();
    await expect(page.getByTestId("feed-tab-tudo")).toHaveAttribute("aria-current", "page");
    await page.getByTestId("feed-tab-comunidades").click();
    await expect(page).toHaveURL(/\/feed\?aba=comunidades$/);
    const empty = page.getByTestId("feed-community-empty");
    await expect(empty).toContainText("Você ainda não segue nenhuma comunidade.");
    await expect(empty.getByRole("link", { name: "Achar comunidades" })).toHaveAttribute("href", "/comunidades");
    await page.setViewportSize({ width: 390, height: 900 });
    await noHorizontalScroll(page);
  });

  test("segue pela lista /comunidades sem virar membro", async ({ memberPage: page }) => {
    await page.goto(`/comunidades?q=${encodeURIComponent("E2E Hack Floripa")}`);
    const row = page.getByTestId("community-row").filter({ hasText: "E2E Hack Floripa" });
    await row.getByTestId("community-follow").click();
    await expect(row.getByTestId("community-unfollow")).toBeVisible();
    await expect(row.getByTestId("community-unfollow")).toHaveAttribute("aria-pressed", "true");
    const db = openE2eDb();
    const id = await me();
    expect(
      await db
        .prepare(`SELECT 1 AS ok FROM community_follows f JOIN communities c ON c.id = f."communityId" WHERE c.slug = ? AND f."memberId" = ?`)
        .get(SEG, id),
    ).toEqual({ ok: 1 });
    expect(
      await db
        .prepare(`SELECT 1 FROM community_members cm JOIN communities c ON c.id = cm."communityId" WHERE c.slug = ? AND cm."memberId" = ?`)
        .get(SEG, id),
    ).toBeUndefined();
    for (const vw of [390, 1280]) {
      await page.setViewportSize({ width: vw, height: 900 });
      await noHorizontalScroll(page);
      await shot(page, `seguir-lista-${vw === 390 ? "390" : "desktop"}`);
    }
  });

  test("página da comunidade mostra que segue e deixa de seguir", async ({ memberPage: page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/comunidade/${SEG}`);
    await expect(page.getByTestId("community-following-chip")).toBeVisible();
    await expect(page.getByTestId("community-follow-hint")).toContainText("no seu feed");
    // seguir não dá o mural: quem posta é membro
    await expect(page.getByTestId("community-join")).toBeVisible();
    await noHorizontalScroll(page);
    await shot(page, "seguir-comunidade-390");
    await page.getByTestId("community-unfollow").click();
    await expect(page.getByTestId("community-follow")).toBeVisible();
    await expect(page.getByTestId("community-following-chip")).toHaveCount(0);
    // e volta a seguir pela página
    await page.getByTestId("community-follow").click();
    await expect(page.getByTestId("community-unfollow")).toBeVisible();
  });

  test("/feed abre em 'minhas comunidades': aviso, hackathon e mural por data, com páginas", async ({ memberPage: page }) => {
    for (const vw of [1280, 390]) {
      await page.setViewportSize({ width: vw, height: 900 });
      await page.goto("/feed");
      await expect(page.getByTestId("feed-tab-comunidades")).toHaveAttribute("aria-current", "page");
      const list = page.getByTestId("feed-community-updates");
      const items = list.getByTestId("community-update");
      await expect(items).toHaveCount(20);
      await expect(items.nth(0)).toHaveAttribute("data-kind", "hackathon");
      await expect(items.nth(0)).toContainText("E2E Hack Ilha");
      await expect(items.nth(0).getByRole("link", { name: /E2E Hack Ilha/ })).toHaveAttribute("href", "/h/e2e-seguir-floripa-h");
      await expect(items.nth(1)).toHaveAttribute("data-kind", "aviso");
      await expect(items.nth(1)).toContainText("Encontro no sábado");
      await expect(items.nth(2)).toHaveAttribute("data-kind", "post");
      await expect(items.nth(2)).toContainText("Demo do time da UFSC no mural");
      await expect(items.nth(2)).toContainText("E2E Hack Floripa");
      await noHorizontalScroll(page);
      await shot(page, `seguir-feed-${vw === 390 ? "390" : "desktop"}`);
    }
    await page.getByTestId("feed-next-page").click();
    await expect(page).toHaveURL(/\/feed\?aba=comunidades&pagina=2$/);
    const p2 = page.getByTestId("feed-community-updates").getByTestId("community-update");
    await expect(p2).toHaveCount(7);
    await expect(p2.last()).toContainText("post antigo 0");
    await expect(page.getByTestId("feed-next-page")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "← mais novas" })).toHaveAttribute("href", "/feed?aba=comunidades");
    // a aba "tudo" continua com o compositor do feed
    await page.getByTestId("feed-tab-tudo").click();
    await expect(page.getByTestId("feed-tab-tudo")).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("feed-community-updates")).toHaveCount(0);
  });

  test("painel mostra as 3 últimas novidades e a comunidade seguida", async ({ memberPage: page }) => {
    await page.goto("/dashboard");
    const box = page.getByTestId("dashboard-community-updates");
    await expect(box.getByTestId("community-update")).toHaveCount(3);
    await expect(box.getByTestId("community-update").first()).toContainText("E2E Hack Ilha");
    await expect(box.getByRole("link", { name: /ver no feed/ })).toHaveAttribute("href", "/feed?aba=comunidades");
    await expect(page.getByTestId("dashboard-communities")).toContainText("E2E Hack Floripa");
    await expect(page.getByTestId("dashboard-communities")).toContainText("segue");
    await page.setViewportSize({ width: 390, height: 900 });
    await noHorizontalScroll(page);
    await shot(page, "seguir-painel-390");
  });

  test("hackathon publicado avisa quem só segue a comunidade", async ({ memberPage: page }) => {
    const db = openE2eDb();
    const id = await me();
    const c = await db
      .prepare(`INSERT INTO communities (slug, name, city) VALUES (?, 'E2E Seguir Dona', 'Curitiba, PR') RETURNING id`)
      .get<{ id: number }>(DONA);
    await db.prepare(`INSERT INTO community_members ("communityId", "memberId", role) VALUES (?, ?, 'dono')`).run(c!.id, id);
    const fan = await db
      .prepare(`INSERT INTO members ("clerkId", username, email, name) VALUES (?, 'e2e-seguir-fan', 'e2e-seguir-fan@t.dev', 'Fã de Curitiba') RETURNING id`)
      .get<{ id: number }>(FAN);
    await db.prepare(`INSERT INTO community_follows ("communityId", "memberId") VALUES (?, ?)`).run(c!.id, fan!.id);

    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/comunidade/${DONA}/hackathon/novo`);
    await page.getByPlaceholder("Hackathon de Sorocaba 2027").fill("E2E Seguir Hack");
    await page.locator('input[name="startsAt"]').fill("2027-07-10T09:00");
    await page.locator('input[name="endsAt"]').fill("2027-07-11T18:00");
    await page.locator('input[name="location"]').fill("Centro, Curitiba, PR");
    await page.locator('input[name="capacity"]').fill("40");
    await page.getByTestId("community-hackathon-submit").click();
    await expect(page).toHaveURL(new RegExp(`/admin/h/${HACK}\\?novo=1$`));
    await page.getByTestId("ov-status").getByRole("button", { name: "publicar edição" }).click();
    await expect(page.getByTestId("ov-phase")).toHaveText(/inscrições abertas/);

    const notes = await db
      .prepare(`SELECT "memberId" FROM notifications WHERE type = 'edicao_nova' AND href = ? ORDER BY "memberId"`)
      .all<{ memberId: number }>(`/h/${HACK}`);
    expect(notes.map((n) => n.memberId).sort((a, b) => a - b)).toEqual([id, fan!.id].sort((a, b) => a - b));
    const ann = await db.prepare(`SELECT body FROM announcements WHERE "hackathonId" = ?`).all<{ body: string }>(HACK);
    expect(ann).toHaveLength(1);
    expect(ann[0].body).toContain("porque segue essa comunidade");

    // membro (dono) não segue de novo: a API explica
    const api = await memberRequest(page);
    const r = await api.post(`/api/communities/${DONA}/follow`);
    expect(r.status()).toBe(409);
  });

  test("sair da comunidade não deixa um seguir que sobrou de clique em paralelo", async ({ memberPage: page }) => {
    const db = openE2eDb();
    const id = await me();
    const c = await db.prepare("SELECT id FROM communities WHERE slug = ?").get<{ id: number }>(SEG);
    await page.setViewportSize({ width: 390, height: 900 });
    page.on("dialog", (d) => d.accept());
    await page.goto(`/comunidade/${SEG}`);
    await page.getByTestId("community-join").click();
    await expect(page.getByTestId("community-leave")).toBeVisible();
    // o follow que commitou depois de entrar: membro não vê botão pra tirar
    await db
      .prepare(`INSERT INTO community_follows ("communityId", "memberId") VALUES (?, ?) ON CONFLICT DO NOTHING`)
      .run(c!.id, id);
    await page.getByTestId("community-leave").click();
    await expect(page.getByTestId("community-follow")).toBeVisible();
    await expect(page.getByTestId("community-following-chip")).toHaveCount(0);
    const left = await db
      .prepare(`SELECT 1 AS ok FROM community_follows WHERE "communityId" = ? AND "memberId" = ?`)
      .get(c!.id, id);
    expect(left).toBeFalsy();
    await noHorizontalScroll(page);
  });
});
