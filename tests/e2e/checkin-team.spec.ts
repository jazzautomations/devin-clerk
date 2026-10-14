import { expect, test, type APIRequestContext } from "@playwright/test";
import { openE2eDb } from "./db";

// spec 033 US4 (check-in por QR) + US7 (equipe da edição). Login real é
// bloqueado pelo captcha, então o e2e cobre o lado de fora: abas do painel
// e ingresso exigem login, APIs anon → 401 JSON, e o link do ingresso não
// aparece pra anon. O fluxo logado está coberto nos testes de API.
const H = "e2e-checkin-jam";

async function ensureEdition(request: APIRequestContext) {
  await request.get("/api/health"); // força init/migrações no server do e2e
  const db = openE2eDb();
  const future = new Date(Date.now() + 10 * 86_400_000).toISOString();
  await db
    .prepare(
      `INSERT INTO hackathons
         (id, name, organizer, startsAt, format, registrationUrl, tags, active, source)
       VALUES (?, 'E2E Checkin Jam', 'Hack Inova E2E', ?, 'presencial',
               'https://e2e.dev/checkin', '[]', 1, 'e2e')
       ON CONFLICT(id) DO UPDATE SET startsAt = excluded.startsAt, active = 1`,
    )
    .run(H, future);
}

test.describe("check-in e equipe da edição (spec 033 US4/US7)", () => {
  test("abas equipe e check-in do painel exigem login", async ({ page, request }) => {
    await ensureEdition(request);
    for (const tab of ["equipe", "checkin"]) {
      await page.goto(`/admin/h/${H}/${tab}`);
      await expect(page).toHaveURL(/sign-in|sign-up|clerk/i, { timeout: 15000 });
    }
  });

  test("/h/[id]/ingresso exige login", async ({ page, request }) => {
    await ensureEdition(request);
    await page.goto(`/h/${H}/ingresso`);
    await expect(page).toHaveURL(/sign-in|sign-up|clerk/i, { timeout: 15000 });
  });

  test("APIs de equipe e check-in anon → 401 JSON", async ({ request }) => {
    await ensureEdition(request);
    const calls = [
      request.get(`/api/admin/hackathons/${H}/roles`),
      request.post(`/api/admin/hackathons/${H}/roles`, { data: { email: "a@t.dev", role: "staff" } }),
      request.delete(`/api/admin/hackathons/${H}/roles`, { data: { memberId: 1, role: "staff" } }),
      request.get(`/api/admin/hackathons/${H}/checkin?q=ana`),
      request.post(`/api/admin/hackathons/${H}/checkin`, { data: { token: "HH1.x" } }),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status()).toBe(401);
      expect(res.headers()["content-type"]).toContain("application/json");
    }
  });

  test("página da edição não mostra link de ingresso pra anon", async ({ page, request }) => {
    await ensureEdition(request);
    await page.goto(`/h/${H}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "E2E Checkin Jam" })).toBeVisible();
    await expect(page.getByTestId("ticket-link")).toHaveCount(0);
  });
});
