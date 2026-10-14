import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { openE2eDb } from "./db";

// Frente N — acabamentos do QA ponta a ponta, lado público. Login real é
// bloqueado pelo captcha do Clerk: o caminho logado (convite de time,
// notificações, troca de username, deslocar programação) está nos testes
// de API/unit.
const HACK = "e2e-qa-polish";
const SHOTS = process.env.SHOTS_DIR ?? "test-results/feat-n";
const db = openE2eDb();

async function member(tag: string, name: string) {
  const row = await db
    .prepare(
      `INSERT INTO members (clerkId, username, name, email) VALUES (?, ?, ?, ?)
       ON CONFLICT (clerkId) DO UPDATE SET name = excluded.name RETURNING id`,
    )
    .get<{ id: number }>(`e2e_qa_${tag}`, `qa_${tag}`, name, `qa_${tag}@e2e.dev`);
  return row!.id;
}

async function seed(request: APIRequestContext) {
  await request.get("/radar"); // força init/migrações no server do e2e
  await db
    .prepare(
      `INSERT INTO hackathons (id, name, organizer, startsAt, format, location, registrationUrl, tags, active, source)
       VALUES (?, 'E2E QA Polish', 'Hack Inova E2E', ?, 'presencial', 'São Paulo', 'https://e2e.dev/qa', '[]', 1, 'e2e')
       ON CONFLICT (id) DO UPDATE SET startsAt = excluded.startsAt, active = 1`,
    )
    .run(HACK, new Date(Date.now() + 20 * 86_400_000).toISOString());
  await db.prepare("DELETE FROM registrations WHERE hackathonId = ?").run(HACK);
  const shown = await member("visivel", "Vera Visível");
  const hidden = await member("oculto", "Otto Oculto");
  const hidden2 = await member("oculto2", "Olga Oculta");
  const ins = db.prepare(
    "INSERT INTO registrations (memberId, hackathonId, status, publicListing) VALUES (?, ?, 'approved', ?)",
  );
  await ins.run(shown, HACK, 1);
  await ins.run(hidden, HACK, 0);
  await ins.run(hidden2, HACK, 0);
}

const noHorizontalScroll = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test.describe("lista pública de inscritos — só quem optou", () => {
  test.beforeEach(async ({ request }) => {
    await seed(request);
  });

  test("conta todos os aprovados, lista só quem consentiu e explica o porquê", async ({ page }) => {
    await page.goto(`/h/${HACK}`);
    const box = page.getByTestId("public-attendees");
    await expect(box).toContainText("inscritos (3)");
    await expect(box.getByText("@qa_visivel")).toBeVisible();
    await expect(box.getByText("@qa_oculto")).toHaveCount(0);
    await expect(box.getByText("@qa_oculto2")).toHaveCount(0);
    await expect(page.getByTestId("public-attendees-note")).toContainText("2 preferiram não");
    // visitante não vê o controle de opt-in (é do próprio inscrito)
    await expect(page.getByTestId("public-listing-toggle")).toHaveCount(0);
  });

  test("390px sem scroll horizontal na página da edição", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/h/${HACK}`);
    await page.getByTestId("public-attendees").scrollIntoViewIfNeeded();
    expect(await noHorizontalScroll(page)).toBe(true);
    await page.getByTestId("public-attendees").screenshot({ path: `${SHOTS}/inscritos-publicos-390.png` });
  });

  test("PATCH do opt-in deslogado → 401 JSON", async ({ request }) => {
    const res = await request.patch(`/api/hackathons/${HACK}/register`, { data: { publicListing: true } });
    expect(res.status()).toBe(401);
    expect(res.headers()["content-type"]).toContain("application/json");
  });
});
