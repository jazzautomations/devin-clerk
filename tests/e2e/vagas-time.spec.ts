import { expect, type Page } from "@playwright/test";
import { E2E_MEMBER_EMAIL, test } from "./auth";
import { openE2eDb } from "./db";
import { respondInvite } from "@/lib/teamInvites";

// Vagas de time (spec 046, onda 3 — migration 045): abrir vaga, candidatar,
// o time aceitar (vira convite), o convite aceito preencher a vaga e o e-mail
// aparecer pros dois só depois do aceite. O login real é bloqueado pelo
// captcha do Clerk, então a sessão é a do membro de teste (tests/e2e/auth.ts)
// e o outro lado da história é semeado direto no banco do e2e.

const HID = "hack-inova-alphaville-2026"; // edição futura e ativa (seed)
const TEAM = "E2E Vagas Time";
const INTRO = "procuro design pro pitch: a gente faz o back e a demo";
const SEEKER_INTRO = "faço design e protótipo no Figma, quero construir com vocês";
const SEEKER = "e2e_vagas_seeker";

const SHOTS = process.env.E2E_SHOT_DIR;

async function noHorizontalScroll(page: Page, where = "") {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, `scroll horizontal ${where}`).toBeLessThanOrEqual(0);
}

async function me() {
  return (await openE2eDb()
    .prepare("SELECT id, username, email FROM members WHERE email = ?")
    .get<{ id: number; username: string; email: string }>(E2E_MEMBER_EMAIL))!;
}

/** limpa os fixtures da rodada anterior (rerun sem reset de banco) */
async function cleanup() {
  const db = openE2eDb();
  const eu = await me();
  const seeker = await db
    .prepare("SELECT id FROM members WHERE username = ?")
    .get<{ id: number }>(SEEKER);
  const t = await db
    .prepare("SELECT id FROM teams WHERE hackathonId = ? AND name = ?")
    .get<{ id: number }>(HID, TEAM);
  if (t) {
    await db
      .prepare("DELETE FROM opening_applications WHERE \"openingId\" IN (SELECT id FROM team_openings WHERE \"teamId\" = ?)")
      .run(t.id);
    await db.prepare("DELETE FROM team_openings WHERE \"teamId\" = ?").run(t.id);
    await db.prepare("DELETE FROM team_invites WHERE \"teamId\" = ?").run(t.id);
    await db.prepare("DELETE FROM team_members WHERE \"teamId\" = ?").run(t.id);
    await db.prepare("DELETE FROM teams WHERE id = ?").run(t.id);
  }
  const ids = [eu.id, ...(seeker ? [seeker.id] : [])];
  const arr = `{${ids.join(",")}}`;
  await db.prepare("DELETE FROM team_up_signals WHERE \"memberId\" = ANY(?::int[]) OR \"peerId\" = ANY(?::int[])").run(arr, arr);
  await db.prepare("DELETE FROM opening_applications WHERE \"memberId\" = ANY(?::int[])").run(arr);
  await db.prepare("DELETE FROM looking_for_team WHERE \"memberId\" = ANY(?::int[]) AND \"hackathonId\" = ?").run(arr, HID);
  await db.prepare("DELETE FROM notifications WHERE \"memberId\" = ANY(?::int[]) OR \"actorId\" = ANY(?::int[])").run(arr, arr);
  if (seeker) {
    await db.prepare("DELETE FROM registrations WHERE \"memberId\" = ? AND \"hackathonId\" = ?").run(seeker.id, HID);
    await db.prepare("DELETE FROM members WHERE id = ?").run(seeker.id);
  }
}

async function seed() {
  const db = openE2eDb();
  await db
    .prepare("INSERT OR IGNORE INTO registrations (memberId, hackathonId, status) VALUES (?, ?, 'approved')")
    .run((await me()).id, HID);
  const t = await db
    .prepare("INSERT INTO teams (hackathonId, name) VALUES (?, ?) RETURNING id")
    .get<{ id: number }>(HID, TEAM);
  await db
    .prepare("INSERT INTO team_members (teamId, username) VALUES (?, ?)")
    .run(t!.id, (await me()).username);
  const seeker = await db
    .prepare(
      `INSERT INTO members ("clerkId", username, email, name, headline, city, institution, "helpOffer")
       VALUES (?, ?, ?, 'Busca Time', 'design de produto', 'Sorocaba, SP', 'USP', '["design"]') RETURNING id`,
    )
    .get<{ id: number }>(`clerk_${SEEKER}`, SEEKER, `${SEEKER}@t.dev`);
  await db
    .prepare("INSERT INTO registrations (memberId, hackathonId, status) VALUES (?, ?, 'approved')")
    .run(seeker!.id, HID);
  await db
    .prepare("INSERT INTO looking_for_team (memberId, hackathonId, skills, need) VALUES (?, ?, ?, ?)")
    .run(seeker!.id, HID, '["figma","design system"]', "procuro um time pra fazer produto");
  const opening = await db
    .prepare(
      `INSERT INTO team_openings ("teamId", "hackathonId", area, intro, "createdBy")
       VALUES (?, ?, 'design', ?, ?) RETURNING id`,
    )
    .get<{ id: number }>(t!.id, HID, INTRO, (await me()).id);
  await db
    .prepare(`INSERT INTO opening_applications ("openingId", "memberId", intro) VALUES (?, ?, ?)`)
    .run(opening!.id, seeker!.id, SEEKER_INTRO);
  return { teamId: t!.id, openingId: opening!.id, seekerId: seeker!.id };
}

test.describe("vagas de time", () => {
  test("o time aceita a candidatura: vira convite e o e-mail aparece pros dois", async ({ memberPage: page }) => {
    await cleanup();
    const f = await seed();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/times");

    // a vaga e a candidatura aparecem pro time
    await expect(page.getByText(INTRO)).toBeVisible();
    await expect(page.getByText(`@${SEEKER}`).first()).toBeVisible();
    await expect(page.getByText(SEEKER_INTRO)).toBeVisible();
    // antes do aceite o e-mail do candidato não está na tela
    await expect(page.getByText(`${SEEKER}@t.dev`)).toHaveCount(0);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/vagas-antes.png`, fullPage: true });

    await page.getByRole("button", { name: /aceitar e convidar/i }).click();
    await expect(page.getByText(/convite enviado pra @/)).toBeVisible({ timeout: 15000 });
    // o e-mail do candidato aparece depois do aceite
    await expect(page.getByText(`${SEEKER}@t.dev`)).toBeVisible();

    const invite = await openE2eDb()
      .prepare("SELECT id, status FROM team_invites WHERE \"memberId\" = ? AND \"hackathonId\" = ?")
      .get<{ id: number; status: string }>(f.seekerId, HID);
    expect(invite?.status).toBe("pending");

    // o convidado aceita: entra no time e a vaga fica preenchida
    const db = openE2eDb();
    const seekerRow = await db
      .prepare("SELECT id, username FROM members WHERE id = ?")
      .get<{ id: number; username: string }>(f.seekerId);
    await respondInvite(invite!.id, seekerRow!, "accept", HID);
    const membro = await db
      .prepare("SELECT 1 AS ok FROM team_members WHERE \"teamId\" = ? AND username = ?")
      .get(f.teamId, SEEKER);
    expect(membro).toBeTruthy();

    await page.reload();
    await expect(page.getByText(/vaga preenchida/)).toBeVisible();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/vagas-depois.png`, fullPage: true });
  });

  test("procuro time: card com áreas do perfil, convite e bora fazer junto silencioso", async ({ memberPage: page }) => {
    await cleanup();
    const f = await seed();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/times?aba=procurando");

    const card = page.getByTestId("procuro-time-card").first();
    await expect(card).toBeVisible();
    await expect(card.getByText("posso ajudar com design")).toBeVisible();
    await expect(card.getByText(/procuro um time pra fazer produto/)).toBeVisible();

    // sinal sozinho: nada é avisado do outro lado
    await card.getByRole("button", { name: "bora fazer junto" }).click();
    await expect(card.getByText(/sinal enviado/i)).toBeVisible({ timeout: 15000 });
    const aviso = await openE2eDb()
      .prepare("SELECT COUNT(*)::int AS n FROM notifications WHERE \"memberId\" = ?")
      .get<{ n: number }>(f.seekerId);
    expect(aviso!.n).toBe(0);

    // convite a partir do card cria team_invites
    await card.getByRole("button", { name: /convidar pro meu time/i }).click();
    await expect(card.getByText(/convite enviado/i)).toBeVisible({ timeout: 15000 });
    const invite = await openE2eDb()
      .prepare("SELECT status FROM team_invites WHERE \"memberId\" = ? AND \"hackathonId\" = ?")
      .get<{ status: string }>(f.seekerId, HID);
    expect(invite?.status).toBe("pending");
  });

  test("menu tem times e a página não rola de lado em 390px", async ({ memberPage: page }) => {
    await cleanup();
    await seed();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/dashboard");
    const link = page.getByRole("link", { name: "times", exact: true }).first();
    await expect(link).toHaveAttribute("href", "/times");

    await page.setViewportSize({ width: 390, height: 844 });
    for (const url of ["/times", "/times?aba=procurando"]) {
      await page.goto(url);
      await expect(page.getByRole("heading", { name: /Formar time sem adivinhar/ })).toBeVisible();
      await noHorizontalScroll(page, url);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/vagas-390-${url.includes("procurando") ? "procuro" : "vagas"}.png`, fullPage: true });
    }
  });

  test("deslogado: /times pede login e a API responde 401 JSON", async ({ page, request }) => {
    const api = await request.post("/api/openings", { data: { hackathonId: HID, area: "dev", intro: "procuro dev" } });
    expect(api.status()).toBe(401);
    expect(api.headers()["content-type"]).toContain("application/json");
    const teamUp = await request.post("/api/team-up", { data: { username: SEEKER, hackathonId: HID } });
    expect(teamUp.status()).toBe(401);

    await page.goto("/times");
    await expect(page).toHaveURL(/sign-in|sign-up|clerk/i, { timeout: 15000 });
  });
});
