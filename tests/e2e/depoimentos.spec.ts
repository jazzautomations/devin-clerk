import { expect, type Page } from "@playwright/test";
import { E2E_MEMBER_EMAIL, test } from "./auth";
import { openE2eDb } from "./db";

// Depoimento de time (migration 037): o card do painel chama pra escrever,
// o membro escreve sobre quem fez time com ele, aceita o que recebeu (com o
// HTML escapado) e vê em "recebidos". Tudo em 390px sem scroll horizontal.

const SHOTS = process.env.E2E_SHOT_DIR;
const ALVO = "e2e_dep_alvo"; // fez time com o membro e2e: ele escreve sobre o alvo
const AUTOR = "e2e_dep_autor"; // fez time e já escreveu sobre o membro e2e
const PEOPLE = [ALVO, AUTOR];
const HACK = "hackinova-os-2-anhembi-2026"; // encerrada (setembro/2026)
const TEAM = "E2E Depoimento Time";
const RECEBIDO = "<b>Fez o pitch</b> e segurou o front inteiro. Recomendo pra qualquer time, de olho fechado.";
const ESCRITO = "Organizou o quadro do time e ainda achou o bug do deploy às três da manhã. Faria time de novo.";

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
async function written(authorId: number, memberId: number) {
  return openE2eDb()
    .prepare(`SELECT status, body FROM team_testimonials WHERE "authorId" = ? AND "memberId" = ?`)
    .get<{ status: string; body: string }>(authorId, memberId);
}

async function cleanup() {
  const db = openE2eDb();
  const meId = (await me()).id;
  const ids = (await Promise.all(PEOPLE.map(idOf))).filter((x): x is number => x !== null);
  const all = `{${[meId, ...ids].join(",")}}`;
  await db.prepare(`DELETE FROM team_testimonials WHERE "memberId" = ANY(?::int[]) OR "authorId" = ANY(?::int[])`).run(all, all);
  await db.prepare(`DELETE FROM notifications WHERE type = 'testimonial' AND ("memberId" = ANY(?::int[]) OR "actorId" = ANY(?::int[]))`).run(all, all);
  const t = await db.prepare(`SELECT id FROM teams WHERE "hackathonId" = ? AND name = ?`).get<{ id: number }>(HACK, TEAM);
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
  const person = async (username: string, name: string) =>
    (await db
      .prepare(`INSERT INTO members ("clerkId", username, email, name) VALUES (?, ?, ?, ?) RETURNING id`)
      .get<{ id: number }>(`clerk_${username}`, username, `${username}@t.dev`, name))!.id;
  await person(ALVO, "Alvo Depoimento");
  const autor = await person(AUTOR, "Autora Depoimento");
  const t = await db.prepare(`INSERT INTO teams ("hackathonId", name) VALUES (?, ?) RETURNING id`).get<{ id: number }>(HACK, TEAM);
  await db
    .prepare(`INSERT INTO team_members ("teamId", username) VALUES (?, ?), (?, ?), (?, ?)`)
    .run(t!.id, eu.username, t!.id, ALVO, t!.id, AUTOR);
  await db
    .prepare(`INSERT INTO team_testimonials ("memberId", "authorId", "hackathonId", "teamId", body) VALUES (?, ?, ?, ?, ?)`)
    .run(eu.id, autor, HACK, t!.id, RECEBIDO);
}

test.describe.configure({ mode: "serial" });

test.describe("depoimento de time", () => {
  test.beforeAll(async () => {
    await cleanup();
    await seed();
  });
  test.afterAll(cleanup);

  test("anon: API dá 401 e /perfil/depoimentos vai pro cadastro", async ({ request }) => {
    const r = await request.post("/api/testimonials", { data: { username: ALVO, hackathonId: HACK, body: ESCRITO } });
    expect(r.status()).toBe(401);
    expect(await r.json()).toEqual({ error: "Unauthorized" });
    expect((await request.post("/api/testimonials/1/accept")).status()).toBe(401);
    const res = await request.get("/perfil/depoimentos", { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    expect(res.headers()["location"]).toContain(`/sign-up?redirect_url=${encodeURIComponent("/perfil/depoimentos")}`);
  });

  test("o painel chama pra escrever e o membro escreve sobre quem fez time com ele", async ({ memberPage: page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/dashboard");
    const card = page.getByTestId("dashboard-testimonial");
    await expect(card).toContainText("Escreva um depoimento.");
    await expect(card).toContainText(/Você fez time com @/);
    await noHorizontalScroll(page);
    await card.getByRole("link", { name: "escrever →" }).click();
    await expect(page).toHaveURL(/\/perfil\/depoimentos\?aba=escrever$/);

    const hackName = (await openE2eDb().prepare("SELECT name FROM hackathons WHERE id = ?").get<{ name: string }>(HACK))!.name;
    const group = page.getByTestId("write-group").filter({ hasText: hackName });
    await expect(group).toContainText(`Você fez time com @${ALVO} e @${AUTOR} no ${hackName}. Escreva sobre eles.`);
    const box = group.getByTestId(`write-${ALVO}`);
    await box.locator("summary").click();
    const submit = box.getByTestId("testimonial-submit");
    await box.getByTestId("testimonial-body").fill("curto");
    await expect(submit).toBeDisabled();
    await box.getByTestId("testimonial-body").fill(ESCRITO);
    await expect(submit).toBeEnabled();
    await noHorizontalScroll(page);
    await shot(page, "depoimento-escrever-390");
    await submit.click();
    await expect(box.getByTestId("testimonial-sent")).toHaveText(`Enviado. @${ALVO} decide se aparece no perfil.`);

    const eu = await me();
    const alvo = (await idOf(ALVO))!;
    await expect.poll(async () => (await written(eu.id, alvo))?.status).toBe("pendente");
    const n = await openE2eDb()
      .prepare(`SELECT text FROM notifications WHERE "memberId" = ? AND type = 'testimonial'`)
      .get<{ text: string }>(alvo);
    expect(n?.text).toBe(`@${eu.username} escreveu um depoimento sobre você. Aceita?`);

    // enviados: o autor vê "enviado"; repetir dá 409
    await page.reload();
    const sent = page.getByTestId("sent").filter({ hasText: `@${ALVO}` });
    await expect(sent.getByTestId("sent-status")).toHaveText("enviado");
    await expect(page.getByTestId(`write-${ALVO}`)).toHaveCount(0);
    const dup = await page.request.post("/api/testimonials", { data: { username: ALVO, hackathonId: HACK, body: ESCRITO } });
    expect(dup.status()).toBe(409);
    await noHorizontalScroll(page);
  });

  test("aceita o que recebeu, com o HTML escapado, e vê em recebidos", async ({ memberPage: page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/perfil/depoimentos?aba=aceitar");
    const pending = page.getByTestId("pending").filter({ hasText: `@${AUTOR}` });
    await expect(pending.getByTestId("testimonial-text")).toHaveText(RECEBIDO);
    await expect(pending.locator("b")).toHaveCount(0);
    await noHorizontalScroll(page);
    await shot(page, "depoimento-aceitar-390");

    await pending.getByTestId("testimonial-accept").click();
    const banner = page.getByTestId("accepted-banner");
    await expect(banner).toContainText("Aceito. Já aparece em recebidos.");
    await expect(banner.getByTestId("write-back")).toHaveText(`Quer escrever sobre @${AUTOR} também?`);
    await expect(page.getByTestId("pending-empty")).toHaveText("Nada esperando você.");
    const eu = await me();
    const autor = (await idOf(AUTOR))!;
    expect((await written(autor, eu.id))?.status).toBe("aceito");
    // aceitar não avisa o autor
    const n = await openE2eDb()
      .prepare(`SELECT COUNT(*)::int AS n FROM notifications WHERE "memberId" = ? AND type = 'testimonial'`)
      .get<{ n: number }>(autor);
    expect(Number(n?.n)).toBe(0);

    await page.getByTestId("tab-recebidos").click();
    await expect(page).toHaveURL(/aba=recebidos/);
    const item = page.getByTestId("testimonial-list").getByTestId("testimonial").filter({ hasText: `@${AUTOR}` });
    await expect(item.getByTestId("testimonial-text")).toHaveText(RECEBIDO);
    await expect(item).toContainText("Autora Depoimento");
    await expect(item.getByTestId("testimonial-hide")).toBeVisible();
    // o dono não denuncia o próprio depoimento: esconde
    await expect(item.getByTestId("report-open")).toHaveCount(0);
    await noHorizontalScroll(page);
    await shot(page, "depoimento-recebidos-390");

    // esconder tira do perfil e "mostrar de novo" traz de volta
    await item.getByTestId("testimonial-hide").click();
    await expect(page.getByTestId("testimonial-empty")).toHaveText("Depoimento aqui só vem de quem fez time com você.");
    await page.getByTestId("hidden-list").getByTestId("testimonial-show").click();
    await expect(page.getByTestId("testimonial-list").getByTestId("testimonial")).toHaveCount(1);
  });
});
