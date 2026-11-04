import { expect, type Page } from "@playwright/test";
import { E2E_MEMBER_EMAIL, test } from "./auth";
import { openE2eDb } from "./db";

// Copilot do arquivo (spec 046, onda 6: copilot-do-arquivo, migration 055).
// Sem env de LLM no e2e: a resposta sai só com os fatos — que é o modo
// garantido. Cobre perguntar, clicar no resultado, a resposta fixa de
// avaliação, o voto "ajudou?" e a caixa ancorada na edição em /h/*/duvidas.
// Tudo em 390px.

const SHOTS = process.env.E2E_SHOT_DIR;
const H = "e2e-cop-arq"; // edição do arquivo
const H2 = "e2e-cop-viva"; // edição "ao vivo" com prazo
const USER = "e2e_cop_dev";

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

async function cleanup() {
  const db = openE2eDb();
  for (const h of [H, H2]) {
    await db.prepare("DELETE FROM prize_winners WHERE \"categoryId\" IN (SELECT id FROM prize_categories WHERE \"hackathonId\" = ?)").run(h);
    await db.prepare("DELETE FROM prize_categories WHERE \"hackathonId\" = ?").run(h);
    await db.prepare("DELETE FROM project_tech WHERE \"teamId\" IN (SELECT id FROM teams WHERE \"hackathonId\" = ?)").run(h);
    await db.prepare("DELETE FROM team_projects WHERE \"teamId\" IN (SELECT id FROM teams WHERE \"hackathonId\" = ?)").run(h);
    await db.prepare("DELETE FROM team_members WHERE \"teamId\" IN (SELECT id FROM teams WHERE \"hackathonId\" = ?)").run(h);
    await db.prepare("DELETE FROM teams WHERE \"hackathonId\" = ?").run(h);
    await db.prepare("DELETE FROM registrations WHERE \"hackathonId\" = ?").run(h);
    await db.prepare("DELETE FROM hackathons WHERE id = ?").run(h);
  }
  await db.prepare("DELETE FROM copilot_queries").run();
  await db.prepare("DELETE FROM members WHERE username = ?").run(USER);
}

async function seed() {
  await cleanup();
  const db = openE2eDb();
  await db
    .prepare(
      `INSERT INTO hackathons (id, name, organizer, "startsAt", "endsAt", format, "registrationUrl", active, source)
       VALUES (?, 'Hack Copilot Arquivo 2026', 'E2E Org', '2026-02-01 09:00:00', '2026-02-02 18:00:00', 'presencial', 'https://exemplo.dev', 1, 'painel')`,
    )
    .run(H);
  await db
    .prepare(
      `INSERT INTO hackathons (id, name, organizer, "startsAt", "endsAt", format, "registrationUrl", active, source, "submissionDeadline")
       VALUES (?, 'Hack Copilot Viva 2026', 'E2E Org', '2026-03-01 09:00:00', '2026-03-02 18:00:00', 'presencial', 'https://exemplo.dev', 1, 'painel', '2026-03-02 15:00:00')`,
    )
    .run(H2);
  const t = await db.prepare('INSERT INTO teams ("hackathonId", name, placement) VALUES (?, \'Time Copilot\', 1) RETURNING id').get<{ id: number }>(H);
  await db
    .prepare('INSERT INTO team_projects ("teamId", title, tagline, description) VALUES (?, \'Carona do Bem E2E\', \'carona solidária no campus\', \'app de carona universitária\')')
    .run(t!.id);
  await db.prepare('INSERT INTO registrations ("memberId", "hackathonId", status) VALUES (?, ?, \'approved\')').run(await me(), H2);
  return t!.id;
}

test.describe("copilot do arquivo", () => {
  test.beforeEach(async () => {
    await seed();
  });
  test.afterAll(async () => {
    await cleanup();
  });

  test("perguntar 'já fizeram?' e clicar no resultado leva ao projeto", async ({ memberPage }) => {
    await memberPage.setViewportSize({ width: 390, height: 844 });
    await memberPage.goto("/copilot");
    await expect(memberPage.getByRole("heading", { name: "Copilot do arquivo" })).toBeVisible();
    await memberPage.getByTestId("copilot-input").fill("já fizeram app de carona universitária?");
    await memberPage.getByTestId("copilot-ask").click();
    const link = memberPage.getByTestId("copilot-fact-link").filter({ hasText: "Carona do Bem" }).first();
    await expect(link).toBeVisible({ timeout: 15_000 });
    await shot(memberPage, "copilot-resultado");
    await link.click();
    await memberPage.waitForURL(/\/p\/\d+/);
    await noHorizontalScroll(memberPage);
  });

  test("pedido de avaliação recebe a resposta fixa e o voto funciona", async ({ memberPage }) => {
    await memberPage.setViewportSize({ width: 390, height: 844 });
    await memberPage.goto("/copilot");
    await memberPage.getByTestId("copilot-input").fill("minha ideia é boa?");
    await memberPage.getByTestId("copilot-ask").click();
    await expect(memberPage.getByTestId("copilot-summary")).toContainText("Eu não avalio ideia nem projeto", { timeout: 15_000 });
    await expect(memberPage.getByTestId("copilot-footer")).toContainText("Ele não avalia projeto");
    await memberPage.getByTestId("copilot-yes").click();
    await expect(memberPage.getByTestId("copilot-voted")).toBeVisible();
    await noHorizontalScroll(memberPage);
  });

  test("na edição, a caixa pergunta ao arquivo dela (regras)", async ({ memberPage }) => {
    await memberPage.setViewportSize({ width: 390, height: 844 });
    await memberPage.goto(`/h/${H2}/duvidas`);
    await expect(memberPage.getByTestId("copilot-edicao")).toBeVisible();
    await memberPage.getByTestId("copilot-input").fill("qual o prazo de entrega?");
    await memberPage.getByTestId("copilot-ask").click();
    await expect(memberPage.getByTestId("copilot-facts")).toContainText("Prazo de entrega", { timeout: 15_000 });
    await noHorizontalScroll(memberPage);
  });
});
