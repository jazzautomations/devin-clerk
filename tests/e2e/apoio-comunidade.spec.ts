import { expect, type Page } from "@playwright/test";
import { E2E_MEMBER_EMAIL, memberRequest, test } from "./auth";
import { openE2eDb } from "./db";

// Apoio da comunidade (migration 028): o dono cadastra, ordena e remove
// apoiadores no painel /comunidade/[slug]/apoio; a página (pública e logada)
// mostra "Quem apoia" só quando tem alguém; empresa sem conta deixa o
// contato em "quero apoiar esta comunidade" e o pedido cai no painel, com
// notificação pro dono. Tudo também em 390px.

const SHOTS = process.env.E2E_SHOT_DIR;
const SLUG = "e2e-apoio-comunidade";
const NAME = "E2E Apoio Comunidade";
const rand = () => Math.floor(Math.random() * 250) + 1;

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "scroll horizontal").toBeLessThanOrEqual(0);
}
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function cleanup() {
  const db = openE2eDb();
  await db.prepare("DELETE FROM communities WHERE slug = ?").run(SLUG);
  await db.prepare("DELETE FROM notifications WHERE type = 'community_support' AND href LIKE ?").run(`/comunidade/${SLUG}/%`);
}

async function seed() {
  await cleanup();
  const db = openE2eDb();
  const me = await db.prepare("SELECT id FROM members WHERE email = ?").get<{ id: number }>(E2E_MEMBER_EMAIL);
  expect(me, "membro de teste do global-setup").toBeTruthy();
  const c = await db
    .prepare("INSERT INTO communities (slug, name, city, \"createdBy\") VALUES (?, ?, 'Recife, PE', ?) RETURNING id")
    .get<{ id: number }>(SLUG, NAME, me!.id);
  await db.prepare("INSERT INTO community_members (\"communityId\", \"memberId\", role) VALUES (?, ?, 'dono')").run(c!.id, me!.id);
}

const supportersInDb = async () =>
  openE2eDb()
    .prepare(
      `SELECT s.name, s.kind, s.position FROM community_supporters s JOIN communities c ON c.id = s."communityId"
       WHERE c.slug = ? ORDER BY s.position, s.id`,
    )
    .all<{ name: string; kind: string; position: number }>(SLUG);

test.describe.configure({ mode: "serial" });

test.describe("apoio da comunidade", () => {
  test.beforeAll(seed);
  test.afterAll(cleanup);

  test("sem apoiador a seção some; o painel mostra os estados vazios", async ({ page, memberPage }) => {
    await page.goto(`/comunidade/${SLUG}`);
    await expect(page.getByTestId("public-card")).toBeVisible();
    await expect(page.getByTestId("community-supporters")).toHaveCount(0);
    await expect(page.getByText("Quem apoia")).toHaveCount(0);

    await memberPage.setViewportSize({ width: 390, height: 900 });
    await memberPage.goto(`/comunidade/${SLUG}`);
    await expect(memberPage.getByTestId("community-page")).toBeVisible();
    await expect(memberPage.getByTestId("community-supporters")).toHaveCount(0);
    // quem organiza não vê o "quero apoiar" da própria comunidade
    await expect(memberPage.getByTestId("support-cta")).toHaveCount(0);
    await memberPage.getByTestId("community-support-panel").click();
    await expect(memberPage).toHaveURL(new RegExp(`/comunidade/${SLUG}/apoio$`));
    await expect(memberPage.getByTestId("supporters-empty")).toBeVisible();
    await expect(memberPage.getByTestId("support-leads-empty")).toBeVisible();
    await noHorizontalScroll(memberPage);
    await shot(memberPage, "apoio-painel-vazio-390");
  });

  test("dono cadastra, ordena e remove apoiadores (390px)", async ({ memberPage: page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/comunidade/${SLUG}/apoio`);
    const form = page.getByTestId("supporter-form");

    async function cadastrar(name: string, kind: string, extra: { url?: string; logo?: string; desc?: string } = {}) {
      await form.getByLabel("nome").fill(name);
      await page.getByTestId("supporter-kind").selectOption(kind);
      if (extra.url) await form.getByLabel("link (opcional)").fill(extra.url);
      if (extra.logo) await form.getByLabel("logo (opcional, link https)").fill(extra.logo);
      if (extra.desc) await form.getByLabel("o que fazem pela comunidade (opcional)").fill(extra.desc);
      await page.getByTestId("supporter-submit").click();
      await expect(page.getByTestId("supporters-admin-list")).toContainText(name);
    }

    // o tipo não vem escolhido: sem tipo o botão não salva
    await form.getByLabel("nome").fill("E2E Padaria");
    await expect(page.getByTestId("supporter-kind")).toHaveValue("");
    await expect(page.getByTestId("supporter-submit")).toBeDisabled();
    await cadastrar("E2E Padaria", "comida", { url: "https://padaria.example.com", desc: "café da manhã nos hackathons" });
    await cadastrar("E2E Coworking", "espaco", { desc: "cede a sala no fim de semana" });
    await cadastrar("E2E Remover", "outro");
    // logo http é recusado com mensagem
    await form.getByLabel("nome").fill("E2E Logo Ruim");
    await page.getByTestId("supporter-kind").selectOption("premio");
    await form.getByLabel("logo (opcional, link https)").fill("http://x.example.com/logo.png");
    await page.getByTestId("supporter-submit").click();
    await expect(page.getByTestId("supporters-msg")).toContainText(/https/);
    await form.getByLabel("logo (opcional, link https)").fill("");
    await form.getByLabel("nome").fill("");

    expect(await supportersInDb()).toEqual([
      { name: "E2E Padaria", kind: "comida", position: 1 },
      { name: "E2E Coworking", kind: "espaco", position: 2 },
      { name: "E2E Remover", kind: "outro", position: 3 },
    ]);

    await page.getByRole("button", { name: "subir E2E Coworking" }).click();
    await expect(page.getByTestId("supporters-admin-row").first()).toContainText("E2E Coworking");
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "tirar E2E Remover" }).click();
    await expect(page.getByTestId("supporters-admin-row")).toHaveCount(2);
    expect((await supportersInDb()).map((s) => s.name)).toEqual(["E2E Coworking", "E2E Padaria"]);
    await noHorizontalScroll(page);
    await shot(page, "apoio-painel-390");
  });

  test("lista velha no painel: erro recarrega a lista e o próximo clique funciona", async ({ memberPage: page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/comunidade/${SLUG}/apoio`);
    await expect(page.getByTestId("supporters-admin-row")).toHaveCount(2);
    // outra pessoa da organização cadastra enquanto esta tela está aberta
    const db = openE2eDb();
    const c = await db.prepare("SELECT id FROM communities WHERE slug = ?").get<{ id: number }>(SLUG);
    await db
      .prepare(`INSERT INTO community_supporters ("communityId", name, kind, position) VALUES (?, 'E2E Loja Nova', 'outro', 3)`)
      .run(c!.id);
    await page.getByRole("button", { name: "descer E2E Coworking" }).click();
    await expect(page.getByTestId("supporters-msg")).toHaveText("A lista mudou. Confira e tente de novo.");
    await expect(page.getByTestId("supporters-admin-row")).toHaveCount(3);
    await page.getByRole("button", { name: "descer E2E Coworking" }).click();
    await expect(page.getByTestId("supporters-admin-row").first()).toContainText("E2E Padaria");
    expect((await supportersInDb()).map((s) => s.name)).toEqual(["E2E Padaria", "E2E Coworking", "E2E Loja Nova"]);

    // e alguém já tirou o apoiador que esta tela ainda mostra
    await db.prepare("DELETE FROM community_supporters WHERE name = 'E2E Loja Nova'").run();
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "tirar E2E Loja Nova" }).click();
    await expect(page.getByTestId("supporters-msg")).toHaveText("A lista mudou. Confira e tente de novo.");
    await expect(page.getByTestId("supporters-admin-row")).toHaveCount(2);
    // volta à ordem que os testes seguintes esperam
    await page.getByRole("button", { name: "subir E2E Coworking" }).click();
    await expect(page.getByTestId("supporters-admin-row").first()).toContainText("E2E Coworking");
    expect((await supportersInDb()).map((s) => s.name)).toEqual(["E2E Coworking", "E2E Padaria"]);
  });

  test("anon vê Quem apoia e deixa o contato em 'quero apoiar'", async ({ page }) => {
    // /api/leads limita 5/h por IP: este teste usa um IP só dele
    await page.setExtraHTTPHeaders({ "x-forwarded-for": `10.${rand()}.${rand()}.${rand()}` });
    for (const vw of [1280, 390]) {
      await page.setViewportSize({ width: vw, height: 900 });
      await page.goto(`/comunidade/${SLUG}`);
      const list = page.getByTestId("community-supporters");
      await expect(list).toBeVisible();
      await expect(list.getByRole("heading", { name: "Quem apoia" })).toBeVisible();
      await expect(page.getByTestId("community-supporter")).toHaveCount(2);
      await expect(page.getByTestId("community-supporter").first()).toContainText("E2E Coworking");
      await expect(page.getByTestId("community-supporter").first()).toContainText("espaço");
      await expect(list.getByRole("link", { name: /E2E Padaria/ })).toHaveAttribute("href", "https://padaria.example.com/");
      await noHorizontalScroll(page);
      await shot(page, `apoio-publico-${vw === 390 ? "390" : "desktop"}`);
    }

    await page.getByTestId("support-open").click();
    const form = page.getByTestId("support-form");
    await form.getByLabel("empresa ou instituição").fill("E2E Mercado Bom");
    await form.getByLabel("e-mail").fill("e2e-apoio@mercado.example.com");
    // ninguém escolhe o tipo pela empresa: começa em "ainda não sei"
    await expect(page.getByTestId("support-kind")).toHaveValue("");
    await expect(page.getByTestId("support-kind").locator("option:checked")).toHaveText("ainda não sei");
    await form.getByLabel("mensagem (opcional)").fill("vale-compras pros três primeiros");
    await expect(page.getByTestId("support-privacy")).toHaveText(`Seu contato vai pra organização da comunidade ${NAME}.`);
    await noHorizontalScroll(page);
    await page.getByTestId("support-submit").click();
    await expect(page.getByTestId("support-done")).toHaveText("Contato enviado. A organização da comunidade vê seu pedido no painel.");

    // e-mail com parâmetro de mailto escondido é recusado
    const bad = await page.request.post("/api/leads", {
      headers: { "x-forwarded-for": `10.${rand()}.${rand()}.${rand()}` },
      data: { company: "E2E Espiao", email: "contato@empresa.com?bcc=espiao%40evil.com&subject=Proposta", community: SLUG },
    });
    expect(bad.status()).toBe(400);

    const db = openE2eDb();
    const lead = await db
      .prepare(
        `SELECT l.company, l.interest, l."supportKind", l.message FROM leads l JOIN communities c ON c.id = l."communityId"
         WHERE c.slug = ?`,
      )
      .all(SLUG);
    expect(lead).toEqual([
      { company: "E2E Mercado Bom", interest: "comunidade", supportKind: null, message: "vale-compras pros três primeiros" },
    ]);
    const note = await db
      .prepare(
        `SELECT n.text, n.href FROM notifications n JOIN members m ON m.id = n."memberId"
         WHERE n.type = 'community_support' AND m.email = ?`,
      )
      .all(E2E_MEMBER_EMAIL);
    expect(note).toEqual([{ text: `E2E Mercado Bom quer apoiar a comunidade ${NAME}.`, href: `/comunidade/${SLUG}/apoio#pedidos` }]);
  });

  test("o pedido aparece no painel da comunidade", async ({ memberPage: page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/comunidade/${SLUG}`);
    await expect(page.getByTestId("community-support-panel")).toHaveText(/1 pedido/);
    await expect(page.getByTestId("community-supporters")).toBeVisible();
    await page.getByTestId("community-support-panel").click();
    const lead = page.getByTestId("support-lead");
    await expect(lead).toHaveCount(1);
    await expect(lead).toContainText("E2E Mercado Bom");
    // sem tipo escolhido, sem chip de tipo
    await expect(lead.locator(".chip")).toHaveCount(0);
    await expect(lead.getByRole("link", { name: "e2e-apoio@mercado.example.com" })).toHaveAttribute(
      "href",
      "mailto:e2e-apoio@mercado.example.com",
    );
    await noHorizontalScroll(page);
    await shot(page, "apoio-pedidos-390");
  });
});

test("política de privacidade conta pra onde vai o contato do 'quero apoiar'", async ({ page }) => {
  await page.goto("/legal/privacidade");
  await expect(page.getByTestId("privacidade-apoio")).toContainText("dono e pros organizadores daquela comunidade");
});

test.describe("apoio da comunidade — guardas", () => {
  test("membro que não organiza: sem painel (404) e API 403; anon 401; comunidade sem apoiador mostra só o 'quero apoiar'", async ({
    page,
    request,
    memberPage,
  }) => {
    expect((await request.post("/api/communities/hack-inova/supporters", { data: { name: "X", kind: "outro" } })).status()).toBe(401);
    const res = await memberPage.goto("/comunidade/hack-inova/apoio");
    expect(res?.status()).toBe(404);
    const api = await memberRequest(memberPage);
    expect((await api.post("/api/communities/hack-inova/supporters", { data: { name: "X", kind: "outro" } })).status()).toBe(403);

    await memberPage.goto("/comunidade/hack-inova");
    await expect(memberPage.getByTestId("community-support-panel")).toHaveCount(0);
    await expect(memberPage.getByTestId("support-cta")).toBeVisible();

    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/comunidade/hack-inova");
    await expect(page.getByTestId("community-supporters")).toHaveCount(0);
    await expect(page.getByTestId("support-cta")).toBeVisible();
    await noHorizontalScroll(page);
  });
});
