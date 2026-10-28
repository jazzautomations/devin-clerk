import { expect } from "@playwright/test";
import { E2E_MEMBER_EMAIL, test } from "./auth";
import { openE2eDb } from "./db";
import { EVIDENCE_MIN_CHECKINS } from "@/lib/evidence";
import { computeXp, recomputeXp } from "@/lib/xp";

// Nível por entrega (spec 046, nivel-por-entrega) no servidor buildado: o
// painel recalcula o xp pelos fatos verificados e mostra "de onde vem";
// badge aposentada some do perfil; o cron exige o segredo.

const H = "e2e-nivel-entrega";
const CROWD = "clerk_e2e_nivel_pl";

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
  const m = await me();
  await db.prepare("DELETE FROM member_badges WHERE memberId = ? AND badgeId IN ('influente', 'criador')").run(m.id);
  await recomputeXp(m.id);
}

test.afterAll(cleanup);

test("cron do xp sem segredo dá 401", async ({ request }) => {
  const res = await request.post("/api/cron/xp");
  expect(res.status()).toBe(401);
  expect(await res.json()).toEqual({ error: "Unauthorized" });
});

test("painel sem fato mostra como o nível sobe e nenhuma tela promete +0 xp", async ({ memberPage }) => {
  await cleanup();
  const m = await me();
  test.skip((await computeXp(m.id)).total > 0, "membro de teste já tem fato de outro spec");
  await memberPage.setViewportSize({ width: 390, height: 844 });
  await memberPage.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await expect(memberPage.getByTestId("xp-origem-vazio")).toHaveText(
    "Seu primeiro fato conta quando você fizer check-in num hackathon.",
  );
  await expect(memberPage.getByText("+0 xp")).toHaveCount(0);
  await expect(memberPage.getByText(/\+\d+ ?xp/)).toHaveCount(0);
});

test("check-in, entrega travada e prêmio = 190 xp, com 'de onde vem' (390px)", async ({ memberPage }) => {
  await cleanup();
  const db = openE2eDb();
  const m = await me();
  await db
    .prepare(
      `INSERT INTO hackathons (id, name, organizer, startsAt, endsAt, format, registrationUrl, tags, active, source, publishedAt)
       VALUES (?, 'Hack E2E Nível', 'Org', '2025-03-01T09:00:00-03:00', '2025-03-02T18:00:00-03:00', 'presencial', '', '[]', 0, 'painel', '2025-01-01 00:00:00')`,
    )
    .run(H);
  const checkin = async (memberId: number) => {
    const r = await db
      .prepare("INSERT INTO registrations (memberId, hackathonId, status) VALUES (?, ?, 'approved') RETURNING id")
      .get<{ id: number }>(memberId, H);
    await db.prepare("INSERT INTO checkins (registrationId, at) VALUES (?, '2025-03-01 12:00:00')").run(r!.id);
  };
  for (let i = 0; i < EVIDENCE_MIN_CHECKINS; i++) {
    const p = await db
      .prepare("INSERT INTO members (clerkId, username, email) VALUES (?, ?, ?) RETURNING id")
      .get<{ id: number }>(`${CROWD}${i}`, `e2e_nivel_pl${i}`, `e2e-nivel-pl${i}@t.dev`);
    await checkin(p!.id);
  }
  await checkin(m.id);
  const t = await db.prepare("INSERT INTO teams (hackathonId, name) VALUES (?, 'Time Nível') RETURNING id").get<{ id: number }>(H);
  await db.prepare("INSERT INTO team_members (teamId, username) VALUES (?, ?)").run(t!.id, m.username);
  await db
    .prepare("INSERT INTO project_submissions (teamId, version, snapshot, submittedAt) VALUES (?, 1, '{}', '2025-03-02 10:00:00')")
    .run(t!.id);
  const c = await db
    .prepare("INSERT INTO prize_categories (hackathonId, kind, name) VALUES (?, 'geral', 'Geral') RETURNING id")
    .get<{ id: number }>(H);
  await db.prepare("INSERT INTO prize_winners (categoryId, teamId, place) VALUES (?, ?, 1)").run(c!.id, t!.id);
  // xp inflado por like antigo: o painel recalcula
  await db.prepare("UPDATE members SET xp = 777 WHERE id = ?").run(m.id);
  const expected = (await computeXp(m.id)).total;
  expect(expected).toBeGreaterThanOrEqual(190);

  await memberPage.setViewportSize({ width: 390, height: 844 });
  await memberPage.goto("/dashboard", { waitUntil: "domcontentloaded" });
  const origem = memberPage.getByTestId("xp-origem");
  await expect(origem).toBeVisible();
  await expect(origem.locator("summary")).toContainText("1 presença · 1 entrega travada · 1 prêmio");
  await expect(memberPage.getByText(`${expected} xp /`)).toBeVisible();
  await expect(origem.getByText("Seu nível sobe com o que você entrega nos hackathons.")).toBeHidden();
  await origem.locator("summary").click();
  await expect(origem.getByText("Seu nível sobe com o que você entrega nos hackathons.")).toBeVisible();
  await expect(origem.getByText("100 xp")).toBeVisible();
  const overflow = await memberPage.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  const row = await db.prepare("SELECT xp FROM members WHERE id = ?").get<{ xp: number }>(m.id);
  expect(row!.xp).toBe(expected);

  // o próprio perfil mostra a mesma conta
  await memberPage.goto(`/u/${m.username}`, { waitUntil: "domcontentloaded" });
  await expect(memberPage.getByTestId("xp-origem").locator("summary")).toContainText("1 prêmio");

  // perfil de outra pessoa: a origem dela, sem a copy em segunda pessoa
  await memberPage.goto("/u/e2e_nivel_pl0", { waitUntil: "domcontentloaded" });
  const dela = memberPage.getByTestId("xp-origem");
  await expect(dela.locator("summary")).toContainText("1 presença");
  await dela.locator("summary").click();
  await expect(dela.getByText("30 xp")).toBeVisible();
  await expect(memberPage.getByText("Seu nível sobe")).toHaveCount(0);
});

test("badge influente antiga some do perfil", async ({ memberPage: page }) => {
  const db = openE2eDb();
  const m = await me();
  await db.prepare("INSERT OR IGNORE INTO member_badges (memberId, badgeId) VALUES (?, 'influente'), (?, 'debut')").run(m.id, m.id);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/u/${m.username}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByText("1ª campanha").first()).toBeVisible();
  await expect(page.getByText("influente")).toHaveCount(0);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
