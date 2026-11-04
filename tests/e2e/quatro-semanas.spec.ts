import { expect, type Page } from "@playwright/test";
import { E2E_MEMBER_EMAIL, memberRequest, signInTicket, test } from "./auth";
import { openE2eDb } from "./db";

// 4 semanas depois (spec 046, onda 5, migration 052). Edição encerrada há 3
// dias: a organização abre as 4 semanas no painel, o time que entregou entra,
// a atualização no diário do projeto marca a semana, quem é de fora vê só o
// agregado e o encerramento antes do prazo aparece com o motivo. Tudo a 390px.
//
// O cron (lembrete de quinta, selo no fim) é testado em unit/API com relógio
// injetado — aqui a página lê a grade ao vivo.

const HACK = "e2e-quatro";
const MEU_TIME = "E2E Quatro Time";
const OUTRO_TIME = "E2E Quatro Outro";
const SEM_ENTREGA = "E2E Quatro Sem Entrega";
const PAR = "e2e_quatro_par";
const FORA_EMAIL = "e2e-quatro-fora+clerk_test@example.com";
const SHOTS = process.env.E2E_SHOT_DIR;
const DAY = 86_400_000;
const dbTime = (t: number) => new Date(t).toISOString().slice(0, 19).replace("T", " ");

const ids: Record<string, number> = {};

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "scroll horizontal").toBeLessThanOrEqual(0);
}

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

test.describe.configure({ mode: "serial" });

async function cleanup() {
  const db = openE2eDb();
  const times = "SELECT id FROM teams WHERE hackathonId = ?";
  await db.prepare(`DELETE FROM posts WHERE teamId IN (${times})`).run(HACK);
  await db.prepare(`DELETE FROM follow_through_weeks WHERE hackathonId = ?`).run(HACK);
  await db.prepare(`DELETE FROM follow_through_teams WHERE hackathonId = ?`).run(HACK);
  await db.prepare(`DELETE FROM follow_through WHERE hackathonId = ?`).run(HACK);
  await db.prepare(`DELETE FROM project_submissions WHERE teamId IN (${times})`).run(HACK);
  await db.prepare(`DELETE FROM team_projects WHERE teamId IN (${times})`).run(HACK);
  await db.prepare(`DELETE FROM team_members WHERE teamId IN (${times})`).run(HACK);
  await db.prepare(`DELETE FROM teams WHERE hackathonId = ?`).run(HACK);
  await db.prepare(`DELETE FROM edition_roles WHERE hackathonId = ?`).run(HACK);
  await db.prepare(`DELETE FROM registrations WHERE hackathonId = ?`).run(HACK);
  await db.prepare(`DELETE FROM notifications WHERE type LIKE 'follow_through%'`).run();
  await db
    .prepare(`DELETE FROM member_badges WHERE badgeId = 'quatro-semanas' AND memberId IN (SELECT id FROM members WHERE username = ?)`)
    .run(PAR);
  await db.prepare("DELETE FROM hackathons WHERE id = ?").run(HACK);
  await db.prepare("DELETE FROM members WHERE username = ?").run(PAR);
  // a segunda pessoa logada (participante de fora) nasce no login do Clerk
  await db.prepare("DELETE FROM members WHERE email = ?").run(FORA_EMAIL);
}

async function seed() {
  await cleanup();
  const db = openE2eDb();
  const me = await db
    .prepare("SELECT id, username FROM members WHERE email = ?")
    .get<{ id: number; username: string }>(E2E_MEMBER_EMAIL);
  expect(me, "membro de teste do global-setup").toBeTruthy();
  ids.me = me!.id;

  // edição encerrada há 3 dias (dentro dos 30 dias pra abrir as 4 semanas)
  await db
    .prepare(
      `INSERT INTO hackathons (id, name, organizer, startsAt, endsAt, format, registrationUrl, tags, active, source)
       VALUES (?, 'E2E Quatro Semanas', 'Hack Inova E2E', ?, ?, 'presencial', ?, '[]', 1, 'painel')`,
    )
    .run(HACK, dbTime(Date.now() - 5 * DAY), dbTime(Date.now() - 3 * DAY), `/h/${HACK}`);
  await db
    .prepare("INSERT INTO edition_roles (hackathonId, memberId, role) VALUES (?, ?, 'organizador') ON CONFLICT DO NOTHING")
    .run(HACK, ids.me);

  await db
    .prepare("INSERT INTO members (clerkId, username, email, name) VALUES (?, ?, ?, 'Par Quatro') ON CONFLICT DO NOTHING")
    .run(`clerk_${PAR}`, PAR, `${PAR}@e2e.invalid`);
  ids.par = (await db.prepare("SELECT id FROM members WHERE username = ?").get<{ id: number }>(PAR))!.id;

  const meu = await db
    .prepare("INSERT INTO teams (hackathonId, name) VALUES (?, ?) RETURNING id")
    .get<{ id: number }>(HACK, MEU_TIME);
  ids.meu = meu!.id;
  for (const u of [me!.username, PAR]) {
    await db.prepare("INSERT INTO team_members (teamId, username) VALUES (?, ?)").run(ids.meu, u);
  }
  await db.prepare("INSERT INTO team_projects (teamId, title) VALUES (?, 'Feira Quatro E2E')").run(ids.meu);
  await db.prepare("INSERT INTO project_submissions (teamId, version, snapshot) VALUES (?, 1, '{}')").run(ids.meu);

  // time de outra pessoa, também entregue
  const outro = await db
    .prepare("INSERT INTO teams (hackathonId, name) VALUES (?, ?) RETURNING id")
    .get<{ id: number }>(HACK, OUTRO_TIME);
  ids.outro = outro!.id;
  await db.prepare("INSERT INTO team_members (teamId, username) VALUES (?, ?)").run(ids.outro, PAR);
  await db.prepare("INSERT INTO team_projects (teamId, title) VALUES (?, 'Painel Quatro E2E')").run(ids.outro);
  await db.prepare("INSERT INTO project_submissions (teamId, version, snapshot) VALUES (?, 1, '{}')").run(ids.outro);

  // time do membro de teste que NÃO entregou: não aparece pra entrar
  const sem = await db
    .prepare("INSERT INTO teams (hackathonId, name) VALUES (?, ?) RETURNING id")
    .get<{ id: number }>(HACK, SEM_ENTREGA);
  ids.sem = sem!.id;
  await db.prepare("INSERT INTO team_members (teamId, username) VALUES (?, ?)").run(ids.sem, me!.username);
  await db.prepare("INSERT INTO team_projects (teamId, title) VALUES (?, 'Rascunho E2E')").run(ids.sem);
}

test.describe("4 semanas depois", () => {
  test.beforeAll(async ({ request }) => {
    await request.get("/api/health");
    await seed();
  });
  test.afterAll(cleanup);

  test("o cron exige o segredo", async ({ request }) => {
    expect((await request.post("/api/cron/quatro-semanas")).status()).toBe(401);
  });

  test("painel abre as 4 semanas e a página dos times começa vazia (390px)", async ({ memberPage: page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/admin/h/${HACK}/quatro-semanas`);
    const form = page.getByTestId("ft-admin-form");
    await expect(form).toBeVisible();
    await page.getByTestId("ft-admin-weeks").fill("4");
    await noHorizontalScroll(page);
    await shot(page, "quatro-admin-abrir-390");
    await page.getByTestId("ft-admin-abrir").click();

    await expect(page.getByTestId("ft-admin-status")).toContainText("aberto");
    await expect(page.getByTestId("ft-admin-form")).toHaveCount(0);
    await noHorizontalScroll(page);

    await page.goto(`/h/${HACK}/quatro-semanas`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("4 semanas depois");
    await expect(page.getByTestId("ft-vazio")).toHaveText("Nenhum time entrou ainda.");
    await expect(page.getByTestId("ft-grade")).toHaveCount(0);
    await noHorizontalScroll(page);
    await shot(page, "quatro-vazio-390");
  });

  test("integrante entra com o time que entregou e vê a grade (390px)", async ({ memberPage: page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/h/${HACK}/quatro-semanas`);
    const entrar = page.getByTestId("ft-entrar");
    await expect(entrar).toBeVisible();
    // o time sem entrega não é oferecido
    await expect(entrar).not.toContainText(SEM_ENTREGA);
    await noHorizontalScroll(page);
    await page.getByTestId("ft-entrar-enviar").click();

    const grade = page.getByTestId("ft-grade");
    await expect(grade).toBeVisible({ timeout: 15_000 });
    await expect(grade.getByTestId("ft-time")).toHaveCount(1);
    await expect(grade).toContainText(MEU_TIME);
    await expect(grade).toContainText("0 de 4");
    await expect(page.getByTestId("ft-agregado")).toContainText("1 time");
    await expect(page.getByTestId("ft-postar")).toBeVisible();
    await noHorizontalScroll(page);
    await shot(page, "quatro-grade-390");

    const db = openE2eDb();
    expect(await db.prepare("SELECT teamId FROM follow_through_teams WHERE hackathonId = ?").all(HACK)).toEqual([{ teamId: ids.meu }]);
    const note = await db
      .prepare("SELECT text, href FROM notifications WHERE memberId = ? AND type = 'follow_through_join'")
      .all(ids.par);
    expect(note).toEqual([{ text: `${MEU_TIME} entrou nas 4 semanas depois.`, href: `/h/${HACK}/quatro-semanas` }]);
  });

  test("atualização no diário do projeto marca a semana (390px)", async ({ memberPage: page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    // o link "postar a atualização" leva pro diário do projeto
    await page.goto(`/h/${HACK}/quatro-semanas`);
    await page.getByTestId("ft-postar").click();
    await expect(page).toHaveURL(new RegExp(`/p/${ids.meu}$`));
    await page.getByLabel("atualização do projeto").fill("semana 1: a feira agora tem mapa das barracas");
    await page.getByRole("button", { name: /publicar/ }).click();
    await expect(page.getByTestId("post-card")).toContainText("semana 1: a feira agora tem mapa", { timeout: 15_000 });

    await page.goto(`/h/${HACK}/quatro-semanas`);
    await expect(page.getByTestId("ft-grade")).toContainText("1 de 4");
    const cell = page.locator('[data-testid="ft-semana"][data-week="1"]');
    await expect(cell).toHaveAttribute("data-done", "1");
    await expect(cell).toHaveAttribute("href", /\/post\/\d+$/);
    await expect(page.getByTestId("ft-postou")).toContainText("já postou a atualização da semana 1");
    await expect(page.getByTestId("ft-postar")).toHaveCount(0);
    await expect(page.getByTestId("ft-agregado")).toContainText("1 postou esta semana");
    await noHorizontalScroll(page);
    await shot(page, "quatro-semana-marcada-390");
  });

  test("sem conta a página pede login (a plataforma é logada)", async ({ page }) => {
    await page.goto(`/h/${HACK}/quatro-semanas`);
    await expect(page).toHaveURL(/\/sign-up/);
  });

  test("participante de fora vê só o agregado, sem a grade por time (390px)", async ({ browser, baseURL }) => {
    // segunda pessoa logada: não é de nenhum time inscrito nem organiza a edição
    const ctx = await browser.newContext({ baseURL });
    const page = await ctx.newPage();
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/sign-in?__clerk_ticket=${await signInTicket(FORA_EMAIL)}`, { waitUntil: "networkidle" });
    await page.waitForURL((u) => !u.pathname.startsWith("/sign-in"), { timeout: 60_000 });
    await page.goto("/dashboard");
    await page.waitForURL(/\/(bem-vindo|dashboard)/, { timeout: 30_000 });
    if (page.url().includes("/bem-vindo")) {
      await page.getByTestId("onboarding-continue").waitFor();
      await page.request.patch("/api/onboarding", { data: { finish: true } });
    }

    await page.goto(`/h/${HACK}/quatro-semanas`);
    await expect(page.getByTestId("ft-agregado")).toContainText("1 time");
    await expect(page.getByTestId("ft-grade")).toHaveCount(0);
    await expect(page.getByTestId("ft-privado")).toBeVisible();
    // não é do time: não vê o botão de entrar nem o de postar
    await expect(page.getByTestId("ft-entrar")).toHaveCount(0);
    await expect(page.getByTestId("ft-postar")).toHaveCount(0);
    await noHorizontalScroll(page);
    await shot(page, "quatro-fora-390");
    await ctx.close();
  });

  test("quem organiza encerra antes do prazo com motivo e a página dos times mostra (390px)", async ({ memberPage: page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/admin/h/${HACK}/quatro-semanas`);
    await expect(page.getByTestId("ft-admin-times")).toContainText(MEU_TIME);
    await page.getByTestId("ft-admin-motivo").fill("o time encerrou o projeto");
    await noHorizontalScroll(page);
    page.once("dialog", (d) => d.accept());
    await page.getByTestId("ft-admin-encerrar").click();
    await expect(page.getByTestId("ft-admin-status")).toContainText("encerrado");
    await expect(page.getByTestId("ft-admin-motivo-final")).toContainText("o time encerrou o projeto");
    await noHorizontalScroll(page);
    await shot(page, "quatro-admin-encerrado-390");

    await page.goto(`/h/${HACK}/quatro-semanas`);
    await expect(page.getByTestId("ft-status")).toContainText("encerrado");
    await expect(page.getByTestId("ft-status")).toContainText("o time encerrou o projeto");
    // encerrado: ninguém entra nem posta mais pela página
    await expect(page.getByTestId("ft-entrar")).toHaveCount(0);
    await noHorizontalScroll(page);

    // a API confirma: não dá pra entrar depois de encerrado
    const api = await memberRequest(page);
    const res = await api.post(`/api/hackathons/${HACK}/quatro-semanas/teams`, { data: { teamId: ids.outro } });
    expect(res.status()).toBe(409);
  });
});
