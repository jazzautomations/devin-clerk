import { expect, type Page } from "@playwright/test";
import { E2E_MEMBER_EMAIL, test } from "./auth";
import { openE2eDb } from "./db";

// Bloqueio e denúncia (migration 032): bloquear pelo /u com confirmação,
// desfazer em /perfil/bloqueados, quem foi bloqueado recebe 404 no perfil de
// quem bloqueou, denúncia pelo perfil (já bloqueia), silenciar e a fila da
// comunidade com "resolver". Tudo também em 390px.

const SHOTS = process.env.E2E_SHOT_DIR;
const ALVO = "e2e_bloq_alvo"; // quem o membro e2e bloqueia e denuncia
const DONO = "e2e_bloq_dono"; // quem bloqueou o membro e2e
const AUTOR = "e2e_bloq_autor"; // escreveu o post denunciado na comunidade
const FISCAL = "e2e_bloq_fiscal"; // denunciou o post
const COM = "e2e-bloq-com";
const PEOPLE = [ALVO, DONO, AUTOR, FISCAL];

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
async function idOf(username: string) {
  return (await openE2eDb().prepare("SELECT id FROM members WHERE username = ?").get<{ id: number }>(username))?.id ?? null;
}

async function cleanup() {
  const db = openE2eDb();
  const meId = await me();
  const ids = (await Promise.all(PEOPLE.map(idOf))).filter((x): x is number => x !== null);
  const all = `{${[meId, ...ids].join(",")}}`;
  await db.prepare(`DELETE FROM reports WHERE "reporterId" = ANY(?::int[]) OR "resolvedBy" = ANY(?::int[])`).run(all, all);
  await db.prepare(`DELETE FROM reports WHERE "targetType" = 'member' AND "targetId" = ANY(?::text[])`).run(`{${ids.join(",")}}`);
  await db.prepare(`DELETE FROM member_blocks WHERE "memberId" = ANY(?::int[]) OR "blockedId" = ANY(?::int[])`).run(all, all);
  await db.prepare(`DELETE FROM member_mutes WHERE "memberId" = ANY(?::int[]) OR "mutedId" = ANY(?::int[])`).run(all, all);
  await db.prepare(`DELETE FROM notifications WHERE type = 'report' AND "memberId" = ANY(?::int[])`).run(all);
  const c = await db.prepare("SELECT id FROM communities WHERE slug = ?").get<{ id: number }>(COM);
  if (c) {
    await db.prepare(`DELETE FROM reports WHERE "communityId" = ?`).run(c.id);
    await db.prepare(`DELETE FROM post_comments WHERE "postId" IN (SELECT id FROM posts WHERE "communityId" = ?)`).run(c.id);
    await db.prepare(`DELETE FROM likes WHERE "postId" IN (SELECT id FROM posts WHERE "communityId" = ?)`).run(c.id);
    await db.prepare(`DELETE FROM posts WHERE "communityId" = ?`).run(c.id);
    await db.prepare("DELETE FROM communities WHERE id = ?").run(c.id);
  }
  for (const id of ids) {
    await db.prepare(`DELETE FROM notifications WHERE "memberId" = ?`).run(id);
    await db.prepare(`DELETE FROM community_members WHERE "memberId" = ?`).run(id);
    await db.prepare(`DELETE FROM posts WHERE "memberId" = ?`).run(id);
    await db.prepare("DELETE FROM members WHERE id = ?").run(id);
  }
}

async function seed() {
  const db = openE2eDb();
  const meId = await me();
  const person = async (username: string, name: string, headline: string) =>
    (await db
      .prepare(`INSERT INTO members ("clerkId", username, email, name, headline) VALUES (?, ?, ?, ?, ?) RETURNING id`)
      .get<{ id: number }>(`clerk_${username}`, username, `${username}@t.dev`, name, headline))!.id;
  await person(ALVO, "Alvo Bloqueio", "faz bot de spam");
  const dono = await person(DONO, "Dona Fechada", "não quer papo");
  const autor = await person(AUTOR, "Autor do Mural", "posta demais");
  const fiscal = await person(FISCAL, "Fiscal do Mural", "lê tudo");
  // quem bloqueou o membro e2e: o /u dela tem que dar 404 pra ele
  await db.prepare(`INSERT INTO member_blocks ("memberId", "blockedId") VALUES (?, ?)`).run(dono, meId);
  // comunidade do membro e2e com um post denunciado por outra pessoa
  const c = await db
    .prepare(`INSERT INTO communities (slug, name, city, description) VALUES (?, 'E2E Bloqueio Recife', 'Recife, PE', 'Comunidade de teste da denúncia.') RETURNING id`)
    .get<{ id: number }>(COM);
  await db.prepare(`INSERT INTO community_members ("communityId", "memberId", role) VALUES (?, ?, 'dono'), (?, ?, 'membro')`).run(c!.id, meId, c!.id, autor);
  const p = await db
    .prepare(`INSERT INTO posts ("memberId", body, "communityId") VALUES (?, 'Compre seguidores no meu link', ?) RETURNING id`)
    .get<{ id: number }>(autor, c!.id);
  await db
    .prepare(
      `INSERT INTO reports ("targetType", "targetId", "reporterId", "targetMemberId", reason, snapshot, "communityId")
       VALUES ('post', ?, ?, ?, 'spam ou propaganda', ?, ?)`,
    )
    .run(String(p!.id), fiscal, autor, `@${AUTOR}: Compre seguidores no meu link`, c!.id);
  // denúncia contra o próprio dono (membro e2e) na fila da comunidade dele:
  // ele não vê, não conta e não resolve
  const mine = await db
    .prepare(`INSERT INTO posts ("memberId", body, "communityId") VALUES (?, 'Post do dono no mural', ?) RETURNING id`)
    .get<{ id: number }>(meId, c!.id);
  await db
    .prepare(
      `INSERT INTO reports ("targetType", "targetId", "reporterId", "targetMemberId", reason, snapshot, "communityId")
       VALUES ('post', ?, ?, ?, 'ofensa contra o dono', 'Post do dono no mural', ?)`,
    )
    .run(String(mine!.id), fiscal, meId, c!.id);
}

test.describe.configure({ mode: "serial" });

test.describe("bloqueio e denúncia", () => {
  test.beforeAll(async () => {
    await cleanup();
    await seed();
  });
  test.afterAll(cleanup);

  test("anon: APIs de bloqueio, silêncio e denúncia dão 401", async ({ request }) => {
    expect((await request.post(`/api/members/${ALVO}/block`)).status()).toBe(401);
    expect((await request.delete(`/api/members/${ALVO}/mute`)).status()).toBe(401);
    expect((await request.post("/api/reports", { data: { targetType: "member", targetId: "1", reason: "spam total" } })).status()).toBe(401);
    expect((await request.patch("/api/reports/1", { data: { resolution: "ok" } })).status()).toBe(401);
  });

  test("quem foi bloqueado recebe 404 no perfil de quem bloqueou", async ({ memberPage: page }) => {
    const res = await page.goto(`/u/${DONO}`);
    expect(res?.status()).toBe(404);
    await expect(page.getByText("Dona Fechada")).toHaveCount(0);
    expect(await page.title()).not.toContain("Dona Fechada");
    // o /perfil leva pra lista
    await page.goto("/perfil");
    await expect(page.getByTestId("perfil-bloqueados-link")).toHaveAttribute("href", "/perfil/bloqueados");
  });

  test("bloqueia pelo perfil com confirmação e desfaz em /perfil/bloqueados", async ({ memberPage: page }) => {
    for (const vw of [1280, 390]) {
      await page.setViewportSize({ width: vw, height: 900 });
      await page.goto(`/u/${ALVO}`);
      await page.getByTestId("profile-safety-toggle").click();
      await expect(page.getByRole("menu")).toBeVisible();
      await noHorizontalScroll(page);
      await page.getByTestId("safety-block").click();
      await expect(page.getByTestId("block-confirm")).toContainText(`Bloquear @${ALVO}?`);
      await shot(page, `bloqueio-confirmar-${vw === 390 ? "390" : "desktop"}`);
      await page.getByTestId("block-confirm-yes").click();
      await expect(page.getByTestId("profile-safety").getByRole("status")).toContainText(`Você bloqueou @${ALVO}.`);
      await expect(page.getByTestId("profile-blocked-note")).toBeVisible();
      await noHorizontalScroll(page);
      expect(
        await openE2eDb()
          .prepare(`SELECT 1 AS ok FROM member_blocks WHERE "memberId" = ? AND "blockedId" = ?`)
          .get(await me(), await idOf(ALVO)),
      ).toEqual({ ok: 1 });

      await page.goto("/perfil/bloqueados");
      const list = page.getByTestId("list-block");
      await expect(list).toContainText("Alvo Bloqueio");
      await expect(page.getByTestId("empty-mute")).toBeVisible();
      await noHorizontalScroll(page);
      await shot(page, `bloqueados-${vw === 390 ? "390" : "desktop"}`);
      await page.getByTestId(`undo-block-${ALVO}`).click();
      await expect(page.getByTestId("empty-block")).toBeVisible();
    }
  });

  test("silencia sem avisar ninguém e aparece na lista de silenciados", async ({ memberPage: page }) => {
    await page.goto(`/u/${ALVO}`);
    await page.getByTestId("profile-safety-toggle").click();
    await page.getByTestId("safety-mute").click();
    await expect(page.getByTestId("profile-safety").getByRole("status")).toContainText(`Você silenciou @${ALVO}.`);
    const alvo = await idOf(ALVO);
    const n = await openE2eDb().prepare(`SELECT COUNT(*)::int AS n FROM notifications WHERE "memberId" = ?`).get<{ n: number }>(alvo);
    expect(Number(n?.n)).toBe(0);
    await page.goto("/perfil/bloqueados");
    await expect(page.getByTestId("list-mute")).toContainText("Alvo Bloqueio");
    await page.getByTestId(`undo-mute-${ALVO}`).click();
    await expect(page.getByTestId("empty-mute")).toBeVisible();
  });

  test("denuncia o perfil: caixa acessível, confirma e já bloqueia", async ({ memberPage: page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/u/${ALVO}`);
    await page.getByTestId("profile-safety-toggle").click();
    await page.getByTestId("report-open").click();
    const dialog = page.getByRole("dialog", { name: `denunciar o perfil de @${ALVO}` });
    await expect(dialog).toBeVisible();
    await noHorizontalScroll(page);
    await shot(page, "denuncia-caixa-390");
    // sem motivo não vai
    await dialog.getByTestId("report-send").click();
    await expect(dialog.getByRole("alert")).toContainText("Escolha um motivo.");
    await dialog.getByRole("radio", { name: "ofensa ou assédio" }).check();
    await dialog.getByRole("textbox").fill("manda mensagem ofensiva no evento");
    await dialog.getByTestId("report-send").click();
    await expect(dialog.getByRole("status")).toContainText(`Recebido. Você não vai mais ver conteúdo de @${ALVO}.`);
    await dialog.getByRole("button", { name: "fechar" }).first().click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId("profile-blocked-note")).toBeVisible();
    const db = openE2eDb();
    const row = await db
      .prepare(`SELECT reason, "communityId", "hackathonId" FROM reports WHERE "targetType" = 'member' AND "targetId" = ? AND "reporterId" = ?`)
      .get(String(await idOf(ALVO)), await me());
    expect(row).toEqual({ reason: "ofensa ou assédio: manda mensagem ofensiva no evento", communityId: null, hackathonId: null });
    // de novo com a primeira aberta: 409 com mensagem clara
    const again = await page.request.post("/api/reports", {
      data: { targetType: "member", targetId: String(await idOf(ALVO)), reason: "spam ou propaganda" },
    });
    expect(again.status()).toBe(409);
  });

  test("fila da comunidade: o dono vê o texto denunciado e resolve", async ({ memberPage: page }) => {
    await page.goto(`/comunidade/${COM}`);
    await expect(page.getByTestId("community-reports-link")).toContainText("denúncias · 1");
    for (const vw of [1280, 390]) {
      await page.setViewportSize({ width: vw, height: 900 });
      await page.goto(`/comunidade/${COM}/denuncias`);
      const item = page.getByTestId("report-item");
      await expect(item).toHaveCount(1);
      await expect(item).toContainText("spam ou propaganda");
      await expect(item).toContainText(`@${AUTOR}: Compre seguidores no meu link`);
      await expect(item.getByRole("link", { name: "ver onde está" })).toHaveAttribute("href", `/comunidade/${COM}`);
      // quem denunciou não aparece
      await expect(item).not.toContainText(FISCAL);
      // a denúncia contra o próprio dono não está na fila dele
      await expect(page.getByText("ofensa contra o dono")).toHaveCount(0);
      await noHorizontalScroll(page);
      await shot(page, `fila-comunidade-${vw === 390 ? "390" : "desktop"}`);
    }
    const id = (await openE2eDb().prepare(`SELECT id FROM reports WHERE "targetType" = 'post' AND reason = 'spam ou propaganda' AND "communityId" = (SELECT id FROM communities WHERE slug = ?)`).get<{ id: number }>(COM))!.id;
    await page.getByTestId(`resolve-${id}`).click();
    await page.getByTestId(`resolve-send-${id}`).click();
    await expect(page.getByTestId(`resolve-form-${id}`).getByRole("alert")).toContainText("Escolha o que foi feito.");
    await page.getByRole("radio", { name: "não vi problema" }).check();
    await page.getByTestId(`resolve-send-${id}`).click();
    await expect(page.getByTestId("report-queue-empty")).toBeVisible();
    await expect(page.getByText("resolvidas há pouco (1)")).toBeVisible();
    await noHorizontalScroll(page);
  });

  test("o dono não resolve denúncia contra si mesmo", async ({ memberPage: page }) => {
    const db = openE2eDb();
    const id = (await db.prepare(`SELECT id FROM reports WHERE reason = 'ofensa contra o dono' AND "targetMemberId" = ?`).get<{ id: number }>(await me()))!.id;
    const res = await page.request.patch(`/api/reports/${id}`, { data: { resolution: "não vi problema" } });
    expect(res.status()).toBe(403);
    const list = await (await page.request.get(`/api/reports?comunidade=${COM}`)).json();
    expect(list.reports.some((r: { id: number }) => r.id === id)).toBe(false);
    expect(await db.prepare(`SELECT "resolvedAt" FROM reports WHERE id = ?`).get(id)).toEqual({ resolvedAt: null });
  });

  test("a fila de outra comunidade não existe pra quem não modera", async ({ memberPage: page }) => {
    const res = await page.goto("/comunidade/hack-inova/denuncias");
    expect(res?.status()).toBe(404);
  });
});
