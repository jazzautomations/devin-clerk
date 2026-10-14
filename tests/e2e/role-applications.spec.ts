import { expect, test, type APIRequestContext } from "@playwright/test";
import { openE2eDb } from "./db";

// frente E (spec 033) — candidatura a voluntário/mentor/jurado. Login real
// é bloqueado pelo captcha do Clerk, então o e2e cobre o lado de fora: CTA
// "Quer ajudar?" pra anon só com os tipos abertos, a página de candidatura
// exige login e as APIs anon → 401 JSON. O fluxo logado está nos testes de API.
const H = "e2e-cand-jam";
const CLOSED = "e2e-cand-fechada";

async function seed(request: APIRequestContext) {
  await request.get("/radar"); // força init/migrações no server do e2e
  const db = openE2eDb();
  const future = new Date(Date.now() + 20 * 86_400_000).toISOString();
  for (const [id, name] of [
    [H, "E2E Cand Jam"],
    [CLOSED, "E2E Cand Fechada"],
  ] as const) {
    await db
      .prepare(
        `INSERT INTO hackathons
           (id, name, organizer, startsAt, format, registrationUrl, tags, active, source)
         VALUES (?, ?, 'Hack Inova E2E', ?, 'presencial', 'https://e2e.dev/cand', '[]', 1, 'e2e')
         ON CONFLICT(id) DO UPDATE SET startsAt = excluded.startsAt, active = 1`,
      )
      .run(id, name, future);
    await db.prepare("DELETE FROM edition_open_kinds WHERE hackathonId = ?").run(id);
  }
  for (const kind of ["voluntario", "mentor"]) {
    await db.prepare("INSERT INTO edition_open_kinds (hackathonId, kind) VALUES (?, ?)").run(H, kind);
  }
}

test.describe("candidatura por tipo (frente E)", () => {
  test("anon vê 'Quer ajudar?' só com os tipos abertos", async ({ page, request }) => {
    await seed(request);
    await page.goto(`/h/${H}`, { waitUntil: "domcontentloaded" });
    const cta = page.getByTestId("help-cta");
    await expect(cta.getByRole("heading", { name: "Quer ajudar?" })).toBeVisible();
    await expect(cta.getByRole("link", { name: "candidatar-se como mentor" })).toHaveAttribute(
      "href",
      `/h/${H}/candidatura/mentor`,
    );
    await expect(cta.getByRole("link", { name: "candidatar-se como voluntário" })).toHaveAttribute(
      "href",
      `/h/${H}/candidatura/voluntario`,
    );
    await expect(cta.getByRole("link", { name: "candidatar-se como jurado" })).toHaveCount(0);
  });

  test("edição sem tipo aberto não mostra o bloco", async ({ page, request }) => {
    await seed(request);
    await page.goto(`/h/${CLOSED}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "E2E Cand Fechada" })).toBeVisible();
    await expect(page.getByTestId("help-cta")).toHaveCount(0);
  });

  test("/h/[id]/candidatura/mentor exige login", async ({ page, request }) => {
    await seed(request);
    await page.goto(`/h/${H}/candidatura/mentor`);
    await expect(page).toHaveURL(/sign-in|clerk/i, { timeout: 15000 });
  });

  test("aba de candidaturas do painel exige login", async ({ page, request }) => {
    await seed(request);
    await page.goto(`/admin/h/${H}/candidaturas`);
    await expect(page).toHaveURL(/sign-in|clerk/i, { timeout: 15000 });
  });

  test("APIs de candidatura anon → 401 JSON", async ({ request }) => {
    await seed(request);
    const calls = [
      request.post(`/api/hackathons/${H}/applications/mentor`, { data: { consent: true } }),
      request.get(`/api/hackathons/${H}/applications/mentor`),
      request.delete(`/api/hackathons/${H}/applications/mentor`),
      request.get(`/api/admin/hackathons/${H}/applications`),
      request.put(`/api/admin/hackathons/${H}/applications`, { data: { kind: "jurado", open: true } }),
      request.patch(`/api/admin/hackathons/${H}/applications/1`, { data: { action: "approve" } }),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status()).toBe(401);
      expect(await res.json()).toEqual({ error: "Unauthorized" });
    }
  });

  test("390px: página da edição com o bloco sem scroll horizontal", async ({ page, request }) => {
    await seed(request);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/h/${H}`, { waitUntil: "domcontentloaded" });
    const cta = page.getByTestId("help-cta");
    await expect(cta).toBeVisible();
    const { sw, cw } = await page.evaluate(() => ({
      sw: document.documentElement.scrollWidth,
      cw: document.documentElement.clientWidth,
    }));
    expect(sw).toBeLessThanOrEqual(cw);
    const dir = process.env.E2E_SHOTS_DIR;
    if (dir) await cta.screenshot({ path: `${dir}/edicao-quer-ajudar-390.png` });
  });
});
