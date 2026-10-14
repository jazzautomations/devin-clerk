import { expect, test, type APIRequestContext } from "@playwright/test";
import { openE2eDb } from "./db";

// Dia do evento (roadmap 037 #5): login real é bloqueado pelo captcha, então
// o e2e cobre o lado de fora — abas de crachás e check-in exigem login, e as
// APIs novas (pacote offline, sync, walk-in, reenvio, PDF) devolvem 401 JSON
// pra anon. O fluxo logado está nos testes de API.
const H = "e2e-dia-do-evento";

async function ensureEdition(request: APIRequestContext) {
  await request.get("/api/health"); // força init/migrações no server do e2e
  const db = openE2eDb();
  const future = new Date(Date.now() + 10 * 86_400_000).toISOString();
  await db
    .prepare(
      `INSERT INTO hackathons
         (id, name, organizer, startsAt, format, registrationUrl, tags, active, source)
       VALUES (?, 'E2E Dia do Evento', 'Hack Inova E2E', ?, 'presencial',
               'https://e2e.dev/dia', '[]', 1, 'e2e')
       ON CONFLICT(id) DO UPDATE SET startsAt = excluded.startsAt, active = 1`,
    )
    .run(H, future);
}

test.describe("dia do evento — offline, walk-in, crachás", () => {
  test("abas crachás e check-in exigem login", async ({ page, request }) => {
    await ensureEdition(request);
    for (const tab of ["crachas", "checkin"]) {
      await page.goto(`/admin/h/${H}/${tab}`);
      await expect(page).toHaveURL(/sign-in|sign-up|clerk/i, { timeout: 15000 });
    }
  });

  test("APIs do dia do evento anon → 401 JSON (pacote offline não sai sem login)", async ({ request }) => {
    await ensureEdition(request);
    const calls = [
      request.get(`/api/admin/hackathons/${H}/checkin/pack`),
      request.post(`/api/admin/hackathons/${H}/checkin/sync`, { data: { items: [{ token: "HH1.x" }] } }),
      request.get(`/api/admin/hackathons/${H}/checkin/walkin`),
      request.post(`/api/admin/hackathons/${H}/checkin/walkin`, { data: { registrationId: 1 } }),
      request.post(`/api/admin/hackathons/${H}/ticket-email`, { data: { registrationId: 1 } }),
      request.get(`/api/admin/hackathons/${H}/crachas`),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status()).toBe(401);
      expect(res.headers()["content-type"]).toContain("application/json");
      expect(await res.text()).not.toContain("entries");
    }
  });
});
