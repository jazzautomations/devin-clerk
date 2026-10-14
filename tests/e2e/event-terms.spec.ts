import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { test } from "./auth";
import { openE2eDb } from "./db";

// frente L — termos do evento. Login real é bloqueado pelo captcha do Clerk,
// então o e2e cobre o lado público: código de conduta, canal de denúncia
// anônimo (grava sem autor), inscrição pedindo nascimento/responsável/dieta/
// conduta/imagem, e as APIs novas → 401 pra anon.
const ED = "e2e-termos-jam";
const SHOTS = "test-results/feat-l";

const START = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
const yearsBefore = (n: number) => `${Number(START.slice(0, 4)) - n}${START.slice(4)}`;

async function seed(request: APIRequestContext) {
  await request.get("/api/health"); // força init/migrações no server do e2e
  const db = openE2eDb();
  await db
    .prepare(
      `INSERT INTO hackathons (id, name, organizer, startsAt, format, registrationUrl, tags, active, source)
       VALUES (?, 'E2E Termos Jam', 'Hack Inova E2E', ?, 'presencial', 'https://e2e.dev/termos', '[]', 1, 'e2e')
       ON CONFLICT(id) DO UPDATE SET startsAt = excluded.startsAt, active = 1`,
    )
    .run(ED, START);
  // edição 16+ com pergunta de dieta ligada
  await db
    .prepare(
      `INSERT INTO edition_terms (hackathonId, minAge, dietEnabled) VALUES (?, 16, 1)
       ON CONFLICT ("hackathonId") DO UPDATE SET minAge = 16, dietEnabled = 1`,
    )
    .run(ED);
}

async function noHorizontalScroll(page: Page) {
  const { sw, cw } = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }));
  expect(sw).toBeLessThanOrEqual(cw);
}

test.describe("termos do evento (frente L)", () => {
  test("código de conduta público com versão e link pro canal de denúncia", async ({ page, request }) => {
    await seed(request);
    await page.goto(`/h/${ED}/conduta`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 1, name: "Código de conduta" })).toBeVisible();
    await expect(page.getByText(/versão 1/)).toBeVisible();
    await expect(page.getByTestId("conduct-text")).toContainText("Assédio de qualquer tipo");
    await expect(page.getByRole("link", { name: /relatar um problema/i })).toHaveAttribute("href", `/h/${ED}/incidente`);
  });

  test("página da edição linka conduta e canal de denúncia", async ({ memberPage: page, request }) => {
    await seed(request);
    await page.goto(`/h/${ED}`, { waitUntil: "domcontentloaded" });
    const box = page.getByTestId("safety-links");
    await expect(box.getByRole("link", { name: /código de conduta/i })).toHaveAttribute("href", `/h/${ED}/conduta`);
    await expect(box.getByRole("link", { name: /relatar um problema/i })).toHaveAttribute("href", `/h/${ED}/incidente`);
  });

  test("denúncia anônima: anon envia e a linha não tem autor", async ({ page, request }) => {
    await seed(request);
    const db = openE2eDb();
    await db.prepare("DELETE FROM incidents WHERE hackathonId = ?").run(ED);
    await page.goto(`/h/${ED}/incidente`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("incident-anon-note")).toContainText(/anônimo/);
    await page.locator("select[name=kind]").selectOption("seguranca");
    await page.locator("textarea[name=description]").fill("Mochila deixada na sala 3 sumiu durante o almoço.");
    await page.locator("input[name=location]").fill("sala 3");
    await page.getByRole("button", { name: /enviar relato/i }).click();
    await expect(page.getByTestId("incident-sent")).toContainText(/sem seu nome/);
    const rows = await db
      .prepare("SELECT reporterId, kind, location FROM incidents WHERE hackathonId = ?")
      .all<{ reporterId: number | null; kind: string; location: string }>(ED);
    expect(rows).toEqual([{ reporterId: null, kind: "seguranca", location: "sala 3" }]);
  });

  test("inscrição pede nascimento, conduta e imagem (desmarcada); menor vê responsável; abaixo da mínima bloqueia", async ({
    memberPage: page,
    request,
  }) => {
    await seed(request);
    await page.goto(`/h/${ED}/inscricao`, { waitUntil: "domcontentloaded" });
    const form = page.getByTestId("registration-form");
    await expect(form.getByLabel(/data de nascimento/i)).toBeVisible();
    await expect(form.getByText(/a partir de 16 anos/)).toBeVisible();
    await expect(form.getByRole("checkbox", { name: /código de conduta/i })).not.toBeChecked();
    const image = form.getByTestId("image-consent-box").getByRole("checkbox");
    await expect(image).not.toBeChecked();
    await expect(form.getByTestId("diet-fields").getByRole("checkbox", { name: "vegano" })).toBeVisible();
    await expect(form.getByTestId("guardian-fields")).toHaveCount(0);

    await form.getByLabel(/data de nascimento/i).fill(yearsBefore(17));
    await expect(form.getByTestId("guardian-fields")).toBeVisible();
    await expect(form.getByTestId("guardian-fields").getByRole("checkbox")).not.toBeChecked();

    await form.getByLabel(/data de nascimento/i).fill(yearsBefore(15));
    await expect(form.getByTestId("under-age")).toContainText("16 anos ou mais");
    await expect(form.getByTestId("guardian-fields")).toHaveCount(0);
  });

  test("APIs novas → 401 JSON pra anon", async ({ request }) => {
    await seed(request);
    for (const res of [
      await request.post(`/api/hackathons/${ED}/register`, {
        data: { consent: true, terms: { birthDate: "2000-01-01", conduct: true } },
      }),
      await request.post(`/api/hackathons/${ED}/image-consent`, { data: { granted: false } }),
      await request.get(`/api/hackathons/${ED}/image-consent`),
      await request.put(`/api/admin/hackathons/${ED}/terms`, { data: { minAge: 18 } }),
      await request.get(`/api/admin/hackathons/${ED}/incidents`),
      await request.patch(`/api/admin/hackathons/${ED}/incidents/1`, { data: { status: "resolvido" } }),
      await request.put(`/api/admin/hackathons/${ED}/incidents/handlers`, { data: { memberId: 1, on: true } }),
      await request.get(`/api/admin/hackathons/${ED}/refeicoes?format=csv`),
    ]) {
      expect(res.status()).toBe(401);
      expect(res.headers()["content-type"]).toContain("application/json");
    }
  });

  test("390px sem scroll horizontal em conduta, incidente e inscrição", async ({ memberPage: page, request }) => {
    await seed(request);
    await page.setViewportSize({ width: 390, height: 844 });
    for (const [path, shot] of [
      [`/h/${ED}/conduta`, "conduta-390.png"],
      [`/h/${ED}/incidente`, "incidente-390.png"],
    ] as const) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(800);
      await noHorizontalScroll(page);
      await page.screenshot({ path: `${SHOTS}/${shot}`, fullPage: true });
    }
    await page.goto(`/h/${ED}/inscricao`, { waitUntil: "domcontentloaded" });
    await page.getByLabel(/data de nascimento/i).fill(yearsBefore(17));
    await page.getByTestId("diet-fields").getByRole("checkbox", { name: "vegano" }).check();
    await page.waitForTimeout(500);
    await noHorizontalScroll(page);
    await page.screenshot({ path: `${SHOTS}/inscricao-menor-390.png`, fullPage: true });
  });
});
