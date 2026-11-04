import { expect, type Page } from "@playwright/test";
import { E2E_MEMBER_EMAIL, test } from "./auth";
import { openE2eDb } from "./db";

// Comunidade dona do próprio espaço (spec 046 onda 3, migration 046): o dono
// resolve a denúncia do mural, apaga o post, edita e apaga aviso, remove o
// autor com "impedir de voltar" e libera a volta, passa a posse e exclui a
// comunidade. Tudo em 390px, sem scroll horizontal.

const COM = "e2e-dona";
const OUTRA = "e2e-dona-outra";
const AUTOR = "e2e_dona_autor";
const AUTOR2 = "e2e_dona_autor2";
const ORG = "e2e_dona_org";
const SHOTS = process.env.E2E_SHOT_DIR;
const MOBILE = { width: 390, height: 900 };

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "scroll horizontal").toBeLessThanOrEqual(0);
}
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}
async function me() {
  return (await openE2eDb().prepare("SELECT id FROM members WHERE email = ?").get<{ id: number }>(E2E_MEMBER_EMAIL))!.id;
}

type Seed = { com: number; outra: number; notice: number; post: number; postB: number; autor: number; autor2: number; org: number };

async function cleanup() {
  const db = openE2eDb();
  for (const slug of [COM, OUTRA]) {
    const c = await db.prepare("SELECT id FROM communities WHERE slug = ?").get<{ id: number }>(slug);
    if (!c) continue;
    await db.prepare(`DELETE FROM reports WHERE "communityId" = ?`).run(c.id);
    await db.prepare(`DELETE FROM community_mod_log WHERE "communityId" = ?`).run(c.id);
    await db.prepare(`DELETE FROM community_bans WHERE "communityId" = ?`).run(c.id);
    await db.prepare(`DELETE FROM community_notices WHERE "communityId" = ?`).run(c.id);
    await db.prepare(`DELETE FROM posts WHERE "communityId" = ?`).run(c.id);
    await db.prepare(`DELETE FROM community_members WHERE "communityId" = ?`).run(c.id);
    await db.prepare(`DELETE FROM community_follows WHERE "communityId" = ?`).run(c.id);
    await db.prepare(`DELETE FROM communities WHERE id = ?`).run(c.id);
  }
  for (const username of [AUTOR, AUTOR2, ORG]) {
    const m = await db.prepare("SELECT id FROM members WHERE username = ?").get<{ id: number }>(username);
    if (!m) continue;
    await db.prepare(`DELETE FROM notifications WHERE "memberId" = ? OR "actorId" = ?`).run(m.id, m.id);
    await db.prepare("DELETE FROM members WHERE id = ?").run(m.id);
  }
}

async function seed(): Promise<Seed> {
  const db = openE2eDb();
  const meId = await me();
  const autor = (await db
    .prepare(`INSERT INTO members ("clerkId", username, email, name) VALUES (?, ?, ?, 'Autora do Mural') RETURNING id`)
    .get<{ id: number }>(`clerk_${AUTOR}`, AUTOR, `${AUTOR}@t.dev`))!.id;
  const autor2 = (await db
    .prepare(`INSERT INTO members ("clerkId", username, email, name) VALUES (?, ?, ?, 'Segunda Autora') RETURNING id`)
    .get<{ id: number }>(`clerk_${AUTOR2}`, AUTOR2, `${AUTOR2}@t.dev`))!.id;
  const org = (await db
    .prepare(`INSERT INTO members ("clerkId", username, email, name) VALUES (?, ?, ?, 'Organizador de Confiança') RETURNING id`)
    .get<{ id: number }>(`clerk_${ORG}`, ORG, `${ORG}@t.dev`))!.id;
  const com = (await db
    .prepare(
      `INSERT INTO communities (slug, name, city, description, "createdBy") VALUES (?, 'E2E Dona do Espaço', 'Recife, PE', 'teste da comunidade dona do espaço', ?) RETURNING id`,
    )
    .get<{ id: number }>(COM, meId))!.id;
  await db
    .prepare(
      `INSERT INTO community_members ("communityId", "memberId", role) VALUES (?, ?, 'dono'), (?, ?, 'membro'), (?, ?, 'membro')`,
    )
    .run(com, meId, com, autor, com, autor2);
  const notice = (await db
    .prepare(
      `INSERT INTO community_notices ("communityId", title, body, "createdBy") VALUES (?, 'Encontro de sábado', 'às 14h no Porto Digital', ?) RETURNING id`,
    )
    .get<{ id: number }>(com, meId))!.id;
  const post = (await db
    .prepare(`INSERT INTO posts ("memberId", body, "communityId") VALUES (?, 'vendo seguidores baratos no meu link', ?) RETURNING id`)
    .get<{ id: number }>(autor, com))!.id;
  const postB = (await db
    .prepare(`INSERT INTO posts ("memberId", body, "communityId") VALUES (?, 'post do mural de quem não foi denunciado', ?) RETURNING id`)
    .get<{ id: number }>(autor2, com))!.id;
  const outra = (await db
    .prepare(`INSERT INTO communities (slug, name, city, "createdBy") VALUES (?, 'E2E Dona Passa a Posse', 'Natal, RN', ?) RETURNING id`)
    .get<{ id: number }>(OUTRA, meId))!.id;
  await db
    .prepare(`INSERT INTO community_members ("communityId", "memberId", role) VALUES (?, ?, 'dono'), (?, ?, 'organizador')`)
    .run(outra, meId, outra, org);
  return { com, outra, notice, post, postB, autor, autor2, org };
}

test.describe.configure({ mode: "serial" });

test.describe("comunidade dona do próprio espaço", () => {
  let seedData: Seed;

  test.beforeAll(async () => {
    await cleanup();
    seedData = await seed();
  });
  test.afterAll(cleanup);

  test("a página da comunidade leva pra moderação; fila, mural e log em 390px", async ({ memberPage: page }) => {
    // navegar primeiro renova o cookie de sessão antes de chamar a API
    await page.goto(`/comunidade/${COM}`);
    // a denúncia vem de outra pessoa: o dono não denuncia o próprio espaço
    const denuncia = await page.request.post("/api/reports", {
      data: { targetType: "post", targetId: String(seedData.post), reason: "spam ou propaganda" },
    });
    expect(denuncia.status()).toBe(201);
    const reportId = (await denuncia.json()).id as number;

    await page.goto(`/comunidade/${COM}`);
    const moderar = page.getByTestId("community-moderation-link");
    await expect(moderar).toContainText("moderar");
    await moderar.click();
    await expect(page).toHaveURL(new RegExp(`/comunidade/${COM}/moderacao$`));

    await page.setViewportSize(MOBILE);
    await expect(page.getByTestId("community-moderation-page")).toBeVisible();
    await noHorizontalScroll(page);
    await shot(page, "moderacao-390");

    // fila: motivo, texto denunciado e o @ de quem escreveu
    const item = page.getByTestId("report-item");
    await expect(item).toHaveCount(1);
    await expect(item).toContainText("spam ou propaganda");
    await expect(item).toContainText(`@${AUTOR}: vendo seguidores baratos no meu link`);
    // o mural recente lista os posts do espaço, com as ações de moderação
    await expect(page.getByTestId("mod-mural-list")).toContainText("post do mural de quem não foi denunciado");
    // log ainda vazio
    await expect(page.getByTestId("mod-log-empty")).toBeVisible();

    // apaga o post direto da fila
    page.once("dialog", (d) => d.accept());
    await page.getByTestId(`mod-delete-post-${seedData.post}`).click();
    await expect
      .poll(async () => (await openE2eDb().prepare("SELECT 1 FROM posts WHERE id = ?").get(seedData.post)) ?? null)
      .toBeNull();

    // resolve a denúncia: sai das abertas e entra no log
    await page.getByTestId(`resolve-${reportId}`).click();
    await page.getByRole("radio", { name: "tirei o conteúdo do ar" }).check();
    await page.getByTestId(`resolve-send-${reportId}`).click();
    await expect(page.getByTestId("report-queue-empty")).toBeVisible();
    const log = page.getByTestId("mod-log-list");
    await expect(log).toContainText(`resolveu uma denúncia · #${reportId}`);
    await noHorizontalScroll(page);
    await shot(page, "moderacao-resolvida-390");

    // quem não modera não abre a página
    const fora = await page.goto("/comunidade/hack-inova/moderacao");
    expect(fora?.status()).toBe(404);
  });

  test("aviso: edita e apaga pela página da comunidade", async ({ memberPage: page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto(`/comunidade/${COM}`);
    await page.getByTestId(`notice-edit-${seedData.notice}`).click();
    const form = page.getByTestId(`notice-form-${seedData.notice}`);
    await form.getByLabel("texto do aviso").fill("às 15h, na sala 3");
    await noHorizontalScroll(page);
    await page.getByTestId(`notice-save-${seedData.notice}`).click();
    // o formulário fecha quando o aviso foi gravado
    await expect(page.getByTestId(`notice-form-${seedData.notice}`)).toHaveCount(0);
    await expect(page.getByTestId("community-notices")).toContainText("às 15h, na sala 3");
    expect(await openE2eDb().prepare("SELECT body FROM community_notices WHERE id = ?").get(seedData.notice)).toEqual({
      body: "às 15h, na sala 3",
    });

    page.once("dialog", (d) => d.accept());
    await page.getByTestId(`notice-delete-${seedData.notice}`).click();
    await expect(page.getByTestId("community-notices")).toHaveCount(0);
    expect(await openE2eDb().prepare("SELECT 1 FROM community_notices WHERE id = ?").get(seedData.notice)).toBeUndefined();
  });

  test("remove o autor do mural com 'impedir de voltar' e libera a volta", async ({ memberPage: page }) => {
    const db = openE2eDb();
    await page.setViewportSize(MOBILE);
    await page.goto(`/comunidade/${COM}/moderacao`);
    await page.getByTestId(`mod-remove-mural-${seedData.postB}`).click();
    await page.getByTestId("mod-ban-check").check();
    await page.getByLabel("motivo do banimento").fill("ofensa no mural");
    await noHorizontalScroll(page);
    await shot(page, "moderacao-ban-390");
    await page.getByTestId(`mod-remove-confirm-${AUTOR2}`).click();

    await expect(page.getByTestId("mod-bans")).toContainText(`@${AUTOR2}`);
    await expect(page.getByTestId("mod-bans")).toContainText("ofensa no mural");
    expect(await db.prepare(`SELECT role FROM community_members WHERE "communityId" = ? AND "memberId" = ?`).get(seedData.com, seedData.autor2)).toBeUndefined();
    expect(await db.prepare(`SELECT reason FROM community_bans WHERE "communityId" = ? AND "memberId" = ?`).get(seedData.com, seedData.autor2)).toEqual({
      reason: "ofensa no mural",
    });
    const log = page.getByTestId("mod-log-list");
    await expect(log).toContainText(`removeu e impediu de voltar · @${AUTOR2}`);

    // sumiu da lista de membros da comunidade
    await page.goto(`/comunidade/${COM}#membros`);
    await expect(page.getByTestId("community-members")).not.toContainText("Segunda Autora");

    // liberar a volta tira o impedimento
    await page.goto(`/comunidade/${COM}/moderacao`);
    await page.getByTestId(`mod-unban-${AUTOR2}`).click();
    await expect(page.getByTestId("mod-bans")).toHaveCount(0);
    expect(await db.prepare(`SELECT 1 FROM community_bans WHERE "communityId" = ? AND "memberId" = ?`).get(seedData.com, seedData.autor2)).toBeUndefined();
    await expect(log).toContainText(`liberou a volta de um membro · @${AUTOR2}`);
    await noHorizontalScroll(page);
  });

  test("passa a posse pra um organizador", async ({ memberPage: page }) => {
    const db = openE2eDb();
    await page.setViewportSize(MOBILE);
    await page.goto(`/comunidade/${OUTRA}/moderacao`);
    await expect(page.getByTestId("mod-owner")).toBeVisible();
    await page.getByTestId("mod-transfer-select").selectOption(ORG);
    page.once("dialog", (d) => d.accept());
    await page.getByTestId("mod-transfer-send").click();
    // quem passou a posse cai na comunidade, agora como organizador
    await expect(page).toHaveURL(new RegExp(`/comunidade/${OUTRA}$`), { timeout: 15_000 });
    await expect(page.getByTestId("community-page")).toContainText("você organiza");
    expect(await db.prepare(`SELECT role FROM community_members WHERE "communityId" = ? AND "memberId" = ?`).get(seedData.outra, seedData.org)).toEqual({
      role: "dono",
    });
    expect(await db.prepare(`SELECT role FROM community_members WHERE "communityId" = ? AND "memberId" = ?`).get(seedData.outra, await me())).toEqual({
      role: "organizador",
    });
    // a área do dono não existe mais pra quem passou, e o log registra
    await page.goto(`/comunidade/${OUTRA}/moderacao`);
    await expect(page.getByTestId("mod-owner")).toHaveCount(0);
    await expect(page.getByTestId("mod-log-list")).toContainText(`passou a posse da comunidade · @${ORG}`);
    await noHorizontalScroll(page);
  });

  test("exclui a comunidade digitando o endereço", async ({ memberPage: page }) => {
    const db = openE2eDb();
    await page.setViewportSize(MOBILE);
    await page.goto(`/comunidade/${COM}/moderacao`);
    await page.getByTestId("mod-delete-open").click();
    // endereço errado: a rota recusa
    await page.getByTestId("mod-delete-confirm").fill("nao-e-esse");
    await page.getByTestId("mod-delete-send").click();
    await expect(page.getByTestId("mod-delete-form").getByRole("alert")).toContainText("Digite o endereço");
    await page.getByTestId("mod-delete-confirm").fill(COM);
    await noHorizontalScroll(page);
    await shot(page, "moderacao-excluir-390");
    await page.getByTestId("mod-delete-send").click();
    await expect(page).toHaveURL(/\/comunidades$/);
    await expect(page.getByTestId("community-row").filter({ hasText: "E2E Dona do Espaço" })).toHaveCount(0);

    expect(await db.prepare(`SELECT hidden, "deletedAt" FROM communities WHERE id = ?`).get(seedData.com)).toMatchObject({ hidden: 1 });
    const gone = await page.goto(`/comunidade/${COM}`);
    expect(gone?.status()).toBe(404);
  });
});
