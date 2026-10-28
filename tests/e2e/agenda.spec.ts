import { expect, type Page } from "@playwright/test";
import { E2E_MEMBER_EMAIL, memberRequest, test } from "./auth";
import { openE2eDb } from "./db";

// Agenda da comunidade (migration 051): o dono marca uma live pelo
// formulário (link de domínio estranho é recusado), publica, quem segue
// recebe a notificação e o feed mostra; RSVP com lotação ("lotado" vira
// talvez), .ics com o horário certo e o teaser público sem o link da sala.
// Tudo em 390px sem scroll horizontal.

const SHOTS = process.env.E2E_SHOT_DIR;
const SLUG = "e2e-agenda-recife";
const FAN = "clerk_e2e_agenda_fan";
const OUTRO = "clerk_e2e_agenda_outro";
const YEAR = new Date().getFullYear() + 1;
const ROOM = "https://meet.google.com/e2e-agenda-sala";

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "scroll horizontal").toBeLessThanOrEqual(0);
}
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function cleanup() {
  const db = openE2eDb();
  const c = await db.prepare("SELECT id FROM communities WHERE slug = ?").get<{ id: number }>(SLUG);
  if (c) {
    await db.prepare(`DELETE FROM notifications WHERE href IN (SELECT '/agenda/' || id::text FROM meetups WHERE "communityId" = ?)`).run(c.id);
    await db.prepare("DELETE FROM communities WHERE id = ?").run(c.id);
  }
  for (const clerkId of [FAN, OUTRO]) {
    const m = await db.prepare(`SELECT id FROM members WHERE "clerkId" = ?`).get<{ id: number }>(clerkId);
    if (!m) continue;
    await db.prepare(`DELETE FROM notifications WHERE "memberId" = ?`).run(m.id);
    await db.prepare(`DELETE FROM meetup_rsvps WHERE "memberId" = ?`).run(m.id);
    await db.prepare(`DELETE FROM community_follows WHERE "memberId" = ?`).run(m.id);
    await db.prepare("DELETE FROM members WHERE id = ?").run(m.id);
  }
}

async function seed() {
  const db = openE2eDb();
  const me = await db.prepare("SELECT id FROM members WHERE email = ?").get<{ id: number }>(E2E_MEMBER_EMAIL);
  const c = await db
    .prepare(`INSERT INTO communities (slug, name, city, description) VALUES (?, 'E2E Agenda Recife', 'Recife, PE', 'Comunidade de teste da agenda.') RETURNING id`)
    .get<{ id: number }>(SLUG);
  await db.prepare(`INSERT INTO community_members ("communityId", "memberId", role) VALUES (?, ?, 'dono')`).run(c!.id, me!.id);
  for (const [clerkId, username] of [
    [FAN, "e2e-agenda-fan"],
    [OUTRO, "e2e-agenda-outro"],
  ]) {
    const m = await db
      .prepare(`INSERT INTO members ("clerkId", username, email, name) VALUES (?, ?, ?, ?) RETURNING id`)
      .get<{ id: number }>(clerkId, username, `${username}@t.dev`, username);
    if (clerkId === FAN) await db.prepare(`INSERT INTO community_follows ("communityId", "memberId") VALUES (?, ?)`).run(c!.id, m!.id);
  }
}

async function meetupId(): Promise<number> {
  const r = await openE2eDb()
    .prepare(`SELECT m.id FROM meetups m JOIN communities c ON c.id = m."communityId" WHERE c.slug = ? ORDER BY m.id DESC LIMIT 1`)
    .get<{ id: number }>(SLUG);
  return r!.id;
}

test.describe.configure({ mode: "serial" });

test.describe("agenda da comunidade", () => {
  test.beforeAll(async () => {
    await cleanup();
    await seed();
  });
  test.afterAll(cleanup);

  test("anon não cria nem responde (401)", async ({ request }) => {
    expect((await request.post("/api/meetups", { data: { community: SLUG } })).status()).toBe(401);
    expect((await request.post("/api/meetups/1/rsvp", { data: { status: "vou" } })).status()).toBe(401);
  });

  test("dono marca a live pelo formulário: link estranho é recusado, publicar avisa quem segue", async ({ memberPage: page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/comunidade/${SLUG}`);
    const block = page.getByTestId("community-agenda");
    await expect(block).toContainText("Nada marcado entre um hackathon e outro.");
    await noHorizontalScroll(page);
    await block.getByTestId("community-agenda-new").click();
    await expect(page).toHaveURL(new RegExp(`/comunidade/${SLUG}/agenda/novo$`));

    const form = page.getByTestId("meetup-form");
    await form.getByTestId("meetup-kind-live").click();
    await expect(form.getByTestId("meetup-kind-live")).toHaveAttribute("aria-pressed", "true");
    await form.locator('input[name="title"]').fill("Live de Go na prática");
    await form.locator('input[name="startsAt"]').fill(`${YEAR}-06-15T19:00`);
    await form.locator('input[name="endsAt"]').fill(`${YEAR}-06-15T21:00`);
    await form.locator('input[name="location"]').fill("CIn UFPE, Recife");
    await form.locator('input[name="onlineUrl"]').fill(ROOM);
    await form.locator('input[name="capacity"]').fill("1");
    await form.locator('textarea[name="description"]').fill("Do hello world ao deploy em uma noite.");
    await form.getByTestId("meetup-embed").fill("https://vimeo.com/123456");
    await noHorizontalScroll(page);
    await shot(page, "agenda-novo-390");
    await form.getByTestId("meetup-publish").click();
    await expect(form.getByTestId("meetup-form-error")).toContainText("YouTube ou da Twitch");

    await form.getByTestId("meetup-embed").fill("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    await form.getByTestId("meetup-publish").click();
    await expect(page).toHaveURL(/\/agenda\/\d+$/);
    await expect(page.getByTestId("meetup-title")).toHaveText("Live de Go na prática");
    await expect(page.getByTestId("meetup-when")).toContainText("19:00 até 21:00");
    // ainda não é hora: a live fica pra depois
    await expect(page.getByTestId("meetup-embed-later")).toBeVisible();
    await noHorizontalScroll(page);
    await shot(page, "agenda-evento-390");

    const id = await meetupId();
    const db = openE2eDb();
    const fan = await db
      .prepare(`SELECT n.text, n.href FROM notifications n JOIN members m ON m.id = n."memberId" WHERE m."clerkId" = ? AND n.type = 'meetup'`)
      .all<{ text: string; href: string }>(FAN);
    expect(fan).toHaveLength(1);
    expect(fan[0].href).toBe(`/agenda/${id}`);
    expect(fan[0].text).toContain("E2E Agenda Recife marcou uma live: Live de Go na prática");
    // quem só tem conta não recebe
    const outro = await db
      .prepare(`SELECT COUNT(*)::int AS n FROM notifications n JOIN members m ON m.id = n."memberId" WHERE m."clerkId" = ?`)
      .get<{ n: number }>(OUTRO);
    expect(outro!.n).toBe(0);
  });

  test("aparece no feed das comunidades e no bloco da página", async ({ memberPage: page }) => {
    const id = await meetupId();
    await page.goto("/feed?aba=comunidades");
    const item = page.getByTestId("feed-community-updates").locator('[data-kind="agenda"]').first();
    await expect(item).toContainText("Live de Go na prática");
    await expect(item.getByRole("link", { name: /Live de Go na prática/ })).toHaveAttribute("href", `/agenda/${id}`);
    await page.goto(`/comunidade/${SLUG}`);
    await expect(page.getByTestId("community-agenda-list").getByTestId("meetup-row")).toHaveCount(1);
    await page.goto(`/comunidade/${SLUG}/agenda`);
    await expect(page.getByTestId("agenda-upcoming").getByTestId("meetup-row")).toContainText("Live de Go na prática");
    await page.setViewportSize({ width: 390, height: 900 });
    await noHorizontalScroll(page);
    await shot(page, "agenda-lista-390");
  });

  test("lotação: com a vaga ocupada, 'vou' vira talvez com 'lotado'", async ({ memberPage: page }) => {
    const id = await meetupId();
    const db = openE2eDb();
    const fan = await db.prepare(`SELECT id FROM members WHERE "clerkId" = ?`).get<{ id: number }>(FAN);
    await db.prepare(`INSERT INTO meetup_rsvps ("meetupId", "memberId", status) VALUES (?, ?, 'vou')`).run(id, fan!.id);
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/agenda/${id}`);
    await expect(page.getByTestId("meetup-counts")).toContainText("1 vai · 0 talvez");
    await expect(page.getByTestId("meetup-counts")).toContainText("lotado");
    await page.getByTestId("rsvp-vou").click();
    await expect(page.getByTestId("rsvp-full")).toContainText("lotado");
    await expect(page.getByTestId("rsvp-talvez")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("meetup-counts")).toContainText("1 vai · 1 talvez");
    // a vaga abre: agora entra
    await db.prepare(`DELETE FROM meetup_rsvps WHERE "meetupId" = ? AND "memberId" = ?`).run(id, fan!.id);
    await page.reload();
    await page.getByTestId("rsvp-vou").click();
    await expect(page.getByTestId("rsvp-vou")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("meetup-counts")).toContainText("1 vai · 0 talvez");
    await expect(page.getByTestId("meetup-room")).toHaveAttribute("href", ROOM);
    await noHorizontalScroll(page);
  });

  test("baixa o .ics com o horário certo (19:00 de Brasília = 22:00 UTC)", async ({ memberPage: page }) => {
    const id = await meetupId();
    await page.goto(`/agenda/${id}`);
    await expect(page.getByTestId("meetup-ics")).toHaveAttribute("href", `/agenda/${id}/evento.ics`);
    const req = await memberRequest(page);
    const res = await req.get(`/agenda/${id}/evento.ics`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/calendar");
    const body = await res.text();
    expect(body).toContain(`DTSTART:${YEAR}0615T220000Z`);
    expect(body).toContain(`DTEND:${YEAR}0616T000000Z`);
    expect(body).toContain("SUMMARY:Live de Go na prática");
    expect(body).not.toContain("meet.google.com");
  });

  test("deslogado vê o teaser sem o link da sala", async ({ page }) => {
    const id = await meetupId();
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/agenda/${id}`);
    const teaser = page.getByTestId("meetup-teaser");
    await expect(teaser).toContainText("Live de Go na prática");
    await expect(teaser).toContainText("E2E Agenda Recife");
    await expect(page.getByTestId("meetup-teaser-when")).toContainText("19:00");
    await expect(page.getByTestId("meetup-teaser-cta")).toHaveAttribute("href", `/sign-up?redirect_url=${encodeURIComponent(`/agenda/${id}`)}`);
    expect(await page.content()).not.toContain("meet.google.com");
    await expect(page.getByTestId("meetup-room")).toHaveCount(0);
    await expect(page.getByTestId("rsvp")).toHaveCount(0);
    await noHorizontalScroll(page);
    await shot(page, "agenda-teaser-390");
    // .ics pede conta
    const r = await page.request.get(`/agenda/${id}/evento.ics`, { maxRedirects: 0 });
    expect(r.status()).not.toBe(200);
  });

  test("cancelar avisa quem respondeu e marca a página", async ({ memberPage: page }) => {
    const id = await meetupId();
    const db = openE2eDb();
    const fan = await db.prepare(`SELECT id FROM members WHERE "clerkId" = ?`).get<{ id: number }>(FAN);
    await db.prepare(`INSERT INTO meetup_rsvps ("meetupId", "memberId", status) VALUES (?, ?, 'talvez') ON CONFLICT DO NOTHING`).run(id, fan!.id);
    await page.goto(`/agenda/${id}`);
    page.once("dialog", (d) => d.accept());
    await page.getByTestId("meetup-cancel").click();
    await expect(page.getByTestId("meetup-cancelled")).toBeVisible();
    await expect(page.getByTestId("rsvp")).toHaveCount(0);
    const n = await db
      .prepare(`SELECT COUNT(*)::int AS n FROM notifications WHERE "memberId" = ? AND type = 'meetup_cancelado'`)
      .get<{ n: number }>(fan!.id);
    expect(n!.n).toBe(1);
  });
});
