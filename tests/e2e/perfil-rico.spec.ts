import { expect, type Page } from "@playwright/test";
import { E2E_MEMBER_EMAIL, test } from "./auth";
import { openE2eDb } from "./db";

// Perfil de builder (spec 046, perfil-rico, migration 041): números de fato,
// comunidades como crachá, áreas de ajuda, projetos fixados, abas, perfil
// aberto pra quem não tem conta, OG e o recado no perfil com anti-corrente.
// Tudo em 390px sem scroll horizontal.

const SHOTS = process.env.E2E_SHOT_DIR;
const ALVO = "e2e_perfil_alvo"; // mesma comunidade do membro e2e: pode deixar recado
const ABERTO = "e2e_perfil_aberto"; // publicProfile = 1
const FECHADO = "e2e_perfil_fechado"; // publicProfile = 0 e recados desligados
const PEOPLE = [ALVO, ABERTO, FECHADO];
const HACK = "hackinova-os-2-anhembi-2026"; // encerrada (setembro/2026)
const TEAM = "E2E Perfil Time";
const RECADO = "Lembra do deploy às três da manhã? Salvou o time inteiro.";

async function noHorizontalScroll(page: Page, where = "") {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `scroll horizontal ${where}`).toBeLessThanOrEqual(0);
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
const memberRow = async (id: number) =>
  (await openE2eDb()
    .prepare(`SELECT "helpOffer", "helpWant", "publicProfile", "recadosFrom" FROM members WHERE id = ?`)
    .get<{ helpOffer: string; helpWant: string; publicProfile: number; recadosFrom: string }>(id))!;

async function cleanup() {
  const db = openE2eDb();
  const meId = (await me()).id;
  const ids = (await Promise.all(PEOPLE.map(idOf))).filter((x): x is number => x !== null);
  const all = `{${[meId, ...ids].join(",")}}`;
  await db.prepare(`DELETE FROM posts WHERE "profileId" = ANY(?::int[]) OR ("memberId" = ANY(?::int[]) AND "profileId" IS NOT NULL)`).run(all, all);
  await db.prepare(`DELETE FROM member_pins WHERE "memberId" = ANY(?::int[])`).run(all);
  await db.prepare(`DELETE FROM notifications WHERE type = 'recado' AND ("memberId" = ANY(?::int[]) OR "actorId" = ANY(?::int[]))`).run(all, all);
  await db.prepare(`DELETE FROM team_testimonials WHERE "memberId" = ANY(?::int[]) OR "authorId" = ANY(?::int[])`).run(all, all);
  await db.prepare(`DELETE FROM registrations WHERE "memberId" = ANY(?::int[]) AND "hackathonId" = ?`).run(all, HACK);
  const t = await db.prepare(`SELECT id FROM teams WHERE "hackathonId" = ? AND name = ?`).get<{ id: number }>(HACK, TEAM);
  if (t) {
    await db.prepare(`DELETE FROM team_members WHERE "teamId" = ?`).run(t.id);
    await db.prepare(`DELETE FROM team_projects WHERE "teamId" = ?`).run(t.id);
    await db.prepare("DELETE FROM teams WHERE id = ?").run(t.id);
  }
  // quem só existe pra deixar a edição elegível (15 check-ins)
  const fillers = await db
    .prepare(`SELECT id FROM members WHERE username LIKE 'e2e_perfil_fill%'`)
    .all<{ id: number }>();
  for (const f of fillers) {
    await db.prepare(`DELETE FROM checkins WHERE "registrationId" IN (SELECT id FROM registrations WHERE "memberId" = ?)`).run(f.id);
    await db.prepare(`DELETE FROM registrations WHERE "memberId" = ?`).run(f.id);
    await db.prepare(`DELETE FROM members WHERE id = ?`).run(f.id);
  }
  // o membro e2e volta ao padrão: outros specs contam com o perfil fechado
  await db
    .prepare(`UPDATE members SET "helpOffer" = '[]', "helpWant" = '[]', "publicProfile" = 0, "recadosFrom" = 'conexoes' WHERE id = ?`)
    .run(meId);
  for (const id of ids) {
    await db.prepare(`DELETE FROM notifications WHERE "memberId" = ?`).run(id);
    await db.prepare("DELETE FROM members WHERE id = ?").run(id);
  }
}

async function seed() {
  const db = openE2eDb();
  const eu = await me();
  const person = async (username: string, name: string, extra: Record<string, unknown> = {}) => {
    const cols = Object.keys(extra);
    const values = Object.values(extra);
    const row = await db
      .prepare(
        `INSERT INTO members ("clerkId", username, email, name${cols.length ? `, ${cols.map((c) => `"${c}"`).join(", ")}` : ""})
         VALUES (?, ?, ?, ?${cols.map(() => ", ?").join("")}) RETURNING id`,
      )
      .get<{ id: number }>(`clerk_${username}`, username, `${username}@t.dev`, name, ...values);
    return row!.id;
  };
  await person(ALVO, "Alvo Perfil");
  await person(ABERTO, "Aberta Perfil", {
    publicProfile: 1,
    helpOffer: '["dev","design"]',
    city: "Sorocaba, SP",
    institution: "USP",
    headline: "front e acessibilidade",
  });
  await person(FECHADO, "Perfil Fechado", { recadosFrom: "ninguem" });

  // time da edição encerrada: aparece em "fixados" e em "projetos", e é o
  // laço que libera o recado do membro e2e no perfil do alvo (recadosFrom
  // 'conexoes': mesmo time basta)
  const t = await db
    .prepare(`INSERT INTO teams ("hackathonId", name) VALUES (?, ?) RETURNING id`)
    .get<{ id: number }>(HACK, TEAM);
  await db
    .prepare(`INSERT INTO team_members ("teamId", username) VALUES (?, ?), (?, ?)`)
    .run(t!.id, eu.username, t!.id, ALVO);
  await db
    .prepare(`INSERT INTO team_projects ("teamId", title, description) VALUES (?, 'E2E Perfil Projeto', 'entrega do e2e')`)
    .run(t!.id);

  // depoimento aceito no perfil aberto: a contagem é o que o anônimo vê
  await db
    .prepare(`INSERT INTO team_testimonials ("memberId", "authorId", "hackathonId", "teamId", body, status, "acceptedAt") VALUES (?, ?, ?, ?, ?, 'aceito', sqlite_now())`)
    .run((await idOf(ABERTO))!, eu.id, HACK, t!.id, "Segurou o front inteiro no sábado e ainda escreveu o pitch. Time de novo, sem pensar.");

  // a edição só conta pra evidência com 15 check-ins (regra antifarm): sem
  // isso o depoimento aceito não entra na contagem do /talento nem do perfil
  const presentes = await db
    .prepare(`SELECT COUNT(DISTINCT r."memberId")::int AS n FROM registrations r JOIN checkins k ON k."registrationId" = r.id WHERE r."hackathonId" = ? AND r.status = 'approved'`)
    .get<{ n: number }>(HACK);
  for (let i = Number(presentes?.n ?? 0); i < 15; i++) {
    const f = await db
      .prepare(`INSERT INTO members ("clerkId", username, email) VALUES (?, ?, ?) RETURNING id`)
      .get<{ id: number }>(`clerk_e2e_perfil_fill${i}`, `e2e_perfil_fill${i}`, `e2e_perfil_fill${i}@t.dev`);
    const r = await db
      .prepare(`INSERT INTO registrations ("memberId", "hackathonId", status) VALUES (?, ?, 'approved') RETURNING id`)
      .get<{ id: number }>(f!.id, HACK);
    await db.prepare(`INSERT INTO checkins ("registrationId") VALUES (?)`).run(r!.id);
  }
}

test.describe.configure({ mode: "serial" });

test.describe("perfil de builder", () => {
  test.beforeAll(async () => {
    await cleanup();
    await seed();
  });
  test.afterAll(cleanup);

  test("anon: perfil fechado é cartão mínimo e a aba não entrega o nome", async ({ request }) => {
    const fechado = await request.get(`/u/${FECHADO}`);
    expect(fechado.status()).toBe(200);
    const html = await fechado.text();
    expect(html).toContain("Esta pessoa ainda não abriu o perfil.");
    // o cartão público mostra nome e headline (é o link que o recrutador abre),
    // mas o título da aba e o OG não: perfil fechado não entrega o nome
    const title = /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? "";
    expect(title.toLowerCase()).toContain("hackahub");
    expect(title).not.toContain("Perfil Fechado");
    const og = await request.get(`/u/${FECHADO}/opengraph-image`);
    expect(og.status()).toBe(200);
    expect(og.headers()["content-type"]).toContain("image/png");
    // recado de perfil fechado é 401 sem sessão
    const r = await request.post(`/api/members/${FECHADO}/recados`, { data: { body: "oi" } });
    expect(r.status()).toBe(401);
  });

  test("anon: perfil aberto mostra números, crachás, fixados e a contagem de depoimentos", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/u/${ABERTO}`);
    const aberto = page.getByTestId("public-profile");
    await expect(aberto).toBeVisible();
    await expect(aberto.getByText("perfil aberto", { exact: true })).toBeVisible();
    await expect(page.getByTestId("profile-numbers")).toBeVisible();
    await expect(page.getByTestId("profile-help")).toContainText("posso ajudar com");
    await expect(page.getByTestId("profile-help")).toContainText("design");
    await expect(page.getByTestId("public-testimonials")).toContainText(/depoimento/);
    // atividade, recado e links pessoais não aparecem pra quem não tem conta
    await expect(page.getByTestId("recados")).toHaveCount(0);
    await expect(page.getByTestId("profile-tabs")).toHaveCount(0);
    await expect(page.getByTestId("u-bicho")).toHaveCount(0);
    await noHorizontalScroll(page, "/u aberto");
    await shot(page, "perfil-aberto-390");
  });

  test("o dono preenche áreas, fixados, perfil aberto e quem deixa recado", async ({ memberPage: page }) => {
    const eu = await me();
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/perfil");
    await page.getByTestId("help-offer").getByRole("button", { name: "design" }).click();
    await page.getByTestId("help-offer").getByRole("button", { name: "produto" }).click();
    await page.getByTestId("help-want").getByRole("button", { name: "dados / IA" }).click();
    await page.getByTestId("pins").getByRole("button", { name: /E2E Perfil Projeto/ }).click();
    await page.getByTestId("public-profile").locator("input").check();
    await page.getByTestId("recados-from").locator("select").selectOption("todos");
    await noHorizontalScroll(page, "/perfil");
    await shot(page, "perfil-form-390");
    await page.getByRole("button", { name: /salvar perfil|salvando/ }).click();
    await expect(page.getByText(/salvo/)).toBeVisible();

    const row = await memberRow(eu.id);
    expect(JSON.parse(row.helpOffer)).toEqual(["design", "produto"]);
    expect(JSON.parse(row.helpWant)).toEqual(["dados"]);
    expect(Number(row.publicProfile)).toBe(1);
    expect(row.recadosFrom).toBe("todos");

    // o /u reflete o que foi salvo
    await page.goto(`/u/${eu.username}`);
    await expect(page.getByTestId("profile-help")).toContainText("design");
    await expect(page.getByTestId("profile-pins")).toContainText("E2E Perfil Projeto");
    await expect(page.getByTestId("profile-pins").getByRole("link")).toHaveAttribute("href", /\/p\/\d+$/);
    await noHorizontalScroll(page, "/u logado");
  });

  test("as quatro abas abrem em 390px sem scroll horizontal", async ({ memberPage: page }) => {
    const eu = await me();
    await page.setViewportSize({ width: 390, height: 900 });
    for (const [aba, testId, texto] of [
      ["atividade", "tab-panel-atividade", /publicou nada|Nada publicado/],
      ["projetos", "profile-projects", /E2E Perfil Projeto/],
      ["trajetoria", "profile-arc", /trajetória/],
      ["colecao", "profile-collection", /badges|Nenhuma conquista/],
    ] as const) {
      await page.goto(`/u/${eu.username}?aba=${aba}`);
      const panel = page.getByTestId(testId);
      await expect(panel).toBeVisible();
      await expect(panel).toContainText(texto);
      await expect(page.getByTestId(`tab-${aba}`)).toHaveAttribute("aria-current", "page");
      await noHorizontalScroll(page, `/u?aba=${aba}`);
      await shot(page, `perfil-aba-${aba}-390`);
    }
  });

  test("deixar recado no perfil de quem tem laço, ver na parede e apagar o próprio", async ({ memberPage: page }) => {
    const eu = await me();
    const alvo = (await idOf(ALVO))!;
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/u/${ALVO}`);
    const caixa = page.getByTestId("recado-form");
    await expect(caixa).toBeVisible();
    await page.getByRole("textbox", { name: "recado" }).fill(RECADO);
    await page.getByTestId("recado-enviar").click();
    await expect(page.getByTestId("recado-ok")).toBeVisible();

    const recado = await openE2eDb()
      .prepare(`SELECT id, body, "profileId" FROM posts WHERE "profileId" = ? AND "memberId" = ? ORDER BY id DESC`)
      .get<{ id: number; body: string; profileId: number }>(alvo, eu.id);
    expect(recado?.body).toBe(RECADO);
    expect(Number(recado?.profileId)).toBe(alvo);
    // aviso agrupado pra quem recebeu
    const notif = await openE2eDb()
      .prepare(`SELECT type, href FROM notifications WHERE "memberId" = ? AND type = 'recado'`)
      .get<{ type: string; href: string }>(alvo);
    expect(notif?.href).toBe(`/u/${ALVO}?recados=todos`);

    await expect(page.getByTestId("recados")).toContainText(RECADO);
    // recado não tem reação (o card esconde os botões)
    const card = page.getByTestId("recados").getByTestId("post-card").first();
    await expect(card.getByTestId("reaction-curti")).toHaveCount(0);
    await noHorizontalScroll(page, "/u recado");
    await shot(page, "perfil-recado-390");

    // o autor apaga o próprio recado pelo menu do card
    page.once("dialog", (d) => d.accept());
    await card.getByTestId("post-menu").click();
    await card.getByRole("menuitem", { name: "apagar" }).click();
    await expect.poll(async () => openE2eDb().prepare("SELECT 1 FROM posts WHERE id = ?").get(recado!.id)).toBeUndefined();
  });

  test("perfil com recados desligados explica e não mostra a caixa", async ({ memberPage: page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/u/${FECHADO}`);
    await expect(page.getByTestId("recados-fechados")).toContainText("desligados");
    await expect(page.getByTestId("recado-form")).toHaveCount(0);
    await expect(page.getByTestId("recado-empty")).toContainText("Deixe o primeiro recado.");
    await noHorizontalScroll(page, "/u recados desligados");
  });

  test("ver mais aparece com mais de 10 recados", async ({ memberPage: page }) => {
    const eu = await me();
    const autor = (await idOf(ALVO))!;
    const db = openE2eDb();
    for (let i = 0; i < 11; i++) {
      await db
        .prepare(`INSERT INTO posts ("memberId", body, "profileId") VALUES (?, ?, ?)`)
        .run(autor, `recado numero ${i + 1}`, eu.id);
    }
    await page.goto(`/u/${eu.username}`);
    const mais = page.getByTestId("recados-ver-mais");
    await expect(mais).toBeVisible();
    await expect(page.getByTestId("recados").getByTestId("post-card")).toHaveCount(10);
    await mais.click();
    await expect(page).toHaveURL(/recados=todos$/);
    await expect(page.getByTestId("recados").getByTestId("post-card")).toHaveCount(11);
    await db.prepare(`DELETE FROM posts WHERE "profileId" = ? AND body LIKE 'recado numero %'`).run(eu.id);
  });

  test("/membros filtra por área e faculdade e /talento mostra depoimento", async ({ memberPage: page }) => {
    const eu = await me();
    // o perfil aberto tem design/USP; o membro e2e tem design/produto e USP não
    await page.goto("/membros?oferece=design");
    await expect(page.locator(`li[data-member="${ABERTO}"]`)).toBeVisible();
    await expect(page.locator(`li[data-member="${eu.username}"]`)).toBeVisible();
    await page.goto("/membros?faculdade=usp");
    await expect(page.locator(`li[data-member="${ABERTO}"]`)).toBeVisible();
    await expect(page.locator(`li[data-member="${eu.username}"]`)).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 900 });
    await noHorizontalScroll(page, "/membros filtros");

    // /talento mostra a contagem e o primeiro trecho do depoimento aceito
    const aberto = (await idOf(ABERTO))!;
    await openE2eDb().prepare(`UPDATE members SET "openTo" = 'trampo' WHERE id = ?`).run(aberto);
    await page.goto("/talento");
    const item = page.locator(`li[data-username="${ABERTO}"]`);
    await expect(item.getByTestId("talent-testimonials")).toContainText("depoimento");
    await expect(item.getByTestId("talent-testimonial")).toContainText("Segurou o front");
    await noHorizontalScroll(page, "/talento");
  });
});
