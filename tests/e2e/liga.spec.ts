import { expect, type Page } from "@playwright/test";
import { E2E_MEMBER_EMAIL, test } from "./auth";
import { openE2eDb } from "./db";
import { EVIDENCE_MIN_CHECKINS } from "@/lib/evidence";
import { bandSentence, leagueStanding, ligaEnabled, semester } from "@/lib/league";

// Liga do semestre por faixa (spec 046, onda 5: liga-por-faixa, migration 054)
// no servidor buildado (HACKAHUB_LIGA_ON=on no playwright.config): a página
// mostra a faixa da pessoa e a comparação com o semestre passado, nunca uma
// posição numérica; a lista de nomes só aparece pra quem ativou o opt-in; o
// link do XpBar leva pra lá; tudo em 390px.

const SHOTS = process.env.E2E_SHOT_DIR;
const H = "e2e-liga-sem";
const CROWD = "clerk_e2e_liga_pl";
const TEAM = "E2E Liga Time";
const ANA = "e2e_liga_ana";
const BETO = "e2e_liga_beto";
const COMMUNITY = "e2e-liga-com";
const DAY = 86_400_000;

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

async function cleanup() {
  const db = openE2eDb();
  await db.prepare("DELETE FROM prize_winners WHERE teamId IN (SELECT id FROM teams WHERE hackathonId = ?)").run(H);
  await db.prepare("DELETE FROM prize_categories WHERE hackathonId = ?").run(H);
  await db.prepare("DELETE FROM project_submissions WHERE teamId IN (SELECT id FROM teams WHERE hackathonId = ?)").run(H);
  await db.prepare("DELETE FROM team_members WHERE teamId IN (SELECT id FROM teams WHERE hackathonId = ?)").run(H);
  await db.prepare("DELETE FROM teams WHERE hackathonId = ?").run(H);
  await db.prepare("DELETE FROM checkins WHERE registrationId IN (SELECT id FROM registrations WHERE hackathonId = ?)").run(H);
  await db.prepare("DELETE FROM registrations WHERE hackathonId = ?").run(H);
  await db.prepare("DELETE FROM hackathons WHERE id = ?").run(H);
  await db.prepare("DELETE FROM members WHERE clerkId LIKE ?").run(`${CROWD}%`);
  await db.prepare("DELETE FROM community_members WHERE communityId IN (SELECT id FROM communities WHERE slug = ?)").run(COMMUNITY);
  await db.prepare("DELETE FROM communities WHERE slug = ?").run(COMMUNITY);
  const m = await me();
  await db.prepare("UPDATE members SET leagueOptIn = 0 WHERE id = ?").run(m.id);
}

const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

/**
 * Uma edição elegível (15 check-ins) dentro do semestre atual, já encerrada,
 * com entrega travada e prêmio do time do membro de teste e de mais duas
 * pessoas: a Ana (na lista) e o Beto (fora dela).
 */
async function seed(): Promise<{ at: Date }> {
  await cleanup();
  const db = openE2eDb();
  const sem = semester();
  const now = Date.now();
  const at = new Date(Math.max(sem.start.getTime() + DAY, Math.min(now, sem.end.getTime()) - 2 * DAY));
  const m = await me();
  await db
    .prepare(
      `INSERT INTO hackathons (id, name, organizer, startsAt, endsAt, format, registrationUrl, tags, active, source,
         publishedAt, submissionDeadline)
       VALUES (?, 'Hack E2E Liga', 'Org', ?, ?, 'presencial', '', '[]', 1, 'painel', '2026-01-01 00:00:00', ?)`,
    )
    .run(H, iso(new Date(at.getTime() - DAY)), iso(at), iso(at));

  const checkin = async (memberId: number) => {
    const r = await db
      .prepare("INSERT INTO registrations (memberId, hackathonId, status) VALUES (?, ?, 'approved') RETURNING id")
      .get<{ id: number }>(memberId, H);
    await db.prepare("INSERT INTO checkins (registrationId, at) VALUES (?, ?)").run(r!.id, iso(at));
  };
  for (let i = 0; i < EVIDENCE_MIN_CHECKINS; i++) {
    const p = await db
      .prepare("INSERT INTO members (clerkId, username, email) VALUES (?, ?, ?) RETURNING id")
      .get<{ id: number }>(`${CROWD}${i}`, `e2e_liga_pl${i}`, `e2e-liga-pl${i}@t.dev`);
    await checkin(p!.id);
  }
  await checkin(m.id);

  const withTeam = async (username: string, name: string) => {
    const t = await db
      .prepare("INSERT INTO teams (hackathonId, name) VALUES (?, ?) RETURNING id")
      .get<{ id: number }>(H, name);
    await db.prepare("INSERT INTO team_members (teamId, username) VALUES (?, ?)").run(t!.id, username);
    await db
      .prepare("INSERT INTO project_submissions (teamId, version, snapshot, submittedAt) VALUES (?, 1, '{}', ?)")
      .run(t!.id, iso(at));
    return t!.id;
  };

  const mine = await withTeam(m.username, TEAM);
  const c = await db
    .prepare("INSERT INTO prize_categories (hackathonId, kind, name) VALUES (?, 'geral', 'Geral') RETURNING id")
    .get<{ id: number }>(H);
  await db.prepare("INSERT INTO prize_winners (categoryId, teamId, place, createdAt) VALUES (?, ?, 1, ?)").run(c!.id, mine, iso(at));

  for (const u of [ANA, BETO]) {
    await db
      .prepare("INSERT OR IGNORE INTO members (clerkId, username, email, name) VALUES (?, ?, ?, ?)")
      .run(`clerk_${u}`, u, `${u}@e2e.invalid`, u === ANA ? "E2E Ana Liga" : "E2E Beto Liga");
    await withTeam(u, `Time ${u}`);
  }
  // a Ana aparece na lista; o Beto não ativou
  await db.prepare("UPDATE members SET leagueOptIn = 1 WHERE username = ?").run(ANA);

  const com = await db
    .prepare(`INSERT INTO communities (slug, name, "createdBy") VALUES (?, 'E2E Liga Com', ?) RETURNING id`)
    .get<{ id: number }>(COMMUNITY, m.id);
  await db.prepare(`INSERT INTO community_members ("communityId", "memberId", role) VALUES (?, ?, 'dono')`).run(com!.id, m.id);
  await db
    .prepare(`INSERT INTO community_members ("communityId", "memberId", role) VALUES (?, (SELECT id FROM members WHERE username = ?), 'membro')`)
    .run(com!.id, ANA);
  return { at };
}

test.beforeAll(async ({ request }) => {
  // aquece o servidor antes de mexer no banco
  await request.get("/api/health");
});

test.afterAll(cleanup);

test("a flag está ligada no e2e (o 404 desligado é provado no vitest)", () => {
  expect(ligaEnabled()).toBe(true);
});

test("mostra a faixa do semestre e o passado, sem posição numérica (390px)", async ({ memberPage: page }) => {
  const sem = semester();
  test.skip(Date.now() < sem.start.getTime() + 3 * DAY, "primeiros dias do semestre: a entrega ainda não travou");
  await seed();
  const m = await me();
  const st = await leagueStanding(m.id, sem);
  expect(st.points).toBeGreaterThan(0);

  await page.setViewportSize({ width: 390, height: 844 });
  const res = await page.goto("/liga", { waitUntil: "domcontentloaded" });
  expect(res?.status()).toBe(200);

  await expect(page.getByTestId("liga-page")).toBeVisible();
  await expect(page.getByText("A liga soma o que você entregou neste semestre.")).toBeVisible();
  const atual = page.getByTestId("liga-faixa-atual");
  await expect(atual).toContainText(sem.label);
  await expect(atual).toContainText(st.band);
  await expect(atual).toContainText(bandSentence(st.band, st.points));
  await expect(atual).toContainText(`${st.points} pontos`);
  await expect(atual).toContainText("1 entrega travada");
  await expect(atual).toContainText("1 prêmio");
  await expect(page.getByTestId("liga-faixa-passado")).toContainText("no passado");

  // nunca "#847": nenhuma posição numérica na página
  const texto = await page.getByTestId("liga-page").innerText();
  expect(texto).not.toMatch(/#\d/);
  expect(texto).not.toMatch(/\b\d+º\b/);
  await noHorizontalScroll(page);
  await shot(page, "liga-faixa");
});

test("a lista só aparece com opt-in, e mostra só quem ativou", async ({ memberPage: page }) => {
  await seed();
  const db = openE2eDb();
  const m = await me();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/liga", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("liga-lista-fechada")).toContainText("A lista de quem está na liga aparece pra quem ativa.");
  await expect(page.getByTestId("liga-lista")).toHaveCount(0);
  await expect(page.getByTestId(`liga-row-${ANA}`)).toHaveCount(0);

  // checkbox controlado (o estado só muda quando a API responde): um clique
  // e a espera pela lista, em vez de check() — que reclicaria no meio do PATCH
  const toggle = page.getByTestId("liga-optin-toggle");
  await expect(toggle).not.toBeChecked();
  await toggle.click();
  await expect(page.getByTestId("liga-lista")).toBeVisible({ timeout: 15000 });
  await expect(toggle).toBeChecked();
  await expect(page.getByTestId(`liga-row-${ANA}`)).toBeVisible();
  await expect(page.getByTestId(`liga-row-${m.username}`)).toContainText("você");
  // o Beto tem ponto e não ativou: fora da lista
  await expect(page.getByTestId(`liga-row-${BETO}`)).toHaveCount(0);
  const row = await db.prepare("SELECT leagueOptIn AS v FROM members WHERE id = ?").get<{ v: number }>(m.id);
  expect(Number(row!.v)).toBe(1);

  // filtro por comunidade: a Ana é da comunidade, o Beto não é de nada
  await expect(page.getByTestId("liga-filtro")).toBeVisible();
  await page.goto(`/liga?comunidade=${COMMUNITY}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId(`liga-row-${ANA}`)).toBeVisible();
  await expect(page.getByTestId(`liga-row-${BETO}`)).toHaveCount(0);
  await noHorizontalScroll(page);
  await shot(page, "liga-lista");

  // desliga de novo: some da lista
  await page.goto("/liga", { waitUntil: "domcontentloaded" });
  await page.getByTestId("liga-optin-toggle").click();
  await expect(page.getByTestId("liga-lista-fechada")).toBeVisible({ timeout: 15000 });
  const off = await db.prepare("SELECT leagueOptIn AS v FROM members WHERE id = ?").get<{ v: number }>(m.id);
  expect(Number(off!.v)).toBe(0);
});

test("o painel leva pra liga pelo XpBar", async ({ memberPage: page }) => {
  await seed();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  const link = page.getByTestId("xp-liga-link");
  await expect(link).toHaveText("ver sua faixa na liga →");
  await link.click();
  await expect(page).toHaveURL(/\/liga$/);
  await expect(page.getByTestId("liga-page")).toBeVisible();
  await noHorizontalScroll(page);
});
