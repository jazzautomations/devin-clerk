import { expect, test, type APIRequestContext } from "@playwright/test";
import { openE2eDb } from "./db";

// BDD do spec 033 US2/US3 — avisos e dúvidas da edição. Login real é
// bloqueado pelo captcha do Clerk (ver AGENTS.md): o e2e cobre o lado
// anônimo — rotas trancadas, APIs 401 JSON e aviso seedado que NÃO vaza
// pra quem não está logado. O caminho logado está nos testes de API.
const HACK = "e2e-avisos-jam";
const SEEDED_TITLE = "Credenciamento abre às 8h (e2e)";

async function seed(request: APIRequestContext) {
  // força init/migrações do banco no server do e2e
  await request.get("/radar");
  const db = openE2eDb();
  const future = new Date(Date.now() + 20 * 86_400_000).toISOString();
  await db
    .prepare(
      `INSERT INTO hackathons (id, name, organizer, startsAt, format, registrationUrl, tags, active, source)
       VALUES (?, 'E2E Avisos Jam', 'Hack Inova E2E', ?, 'presencial', 'https://e2e.dev/avisos', '[]', 1, 'e2e')
       ON CONFLICT(id) DO UPDATE SET startsAt = excluded.startsAt, active = 1`,
    )
    .run(HACK, future);
  const exists = await db.prepare("SELECT 1 FROM announcements WHERE hackathonId = ?").get(HACK);
  if (!exists) {
    await db
      .prepare(
        `INSERT INTO announcements (hackathonId, audience, title, body)
         VALUES (?, 'todos', ?, 'Traga documento com foto.')`,
      )
      .run(HACK, SEEDED_TITLE);
  }
}

test.describe("avisos e dúvidas — sem login (spec 033)", () => {
  test("aba /admin/h/[id]/avisos exige login", async ({ page, request }) => {
    await seed(request);
    await page.goto(`/admin/h/${HACK}/avisos`);
    await expect(page).toHaveURL(/sign-in|clerk/i, { timeout: 15000 });
  });

  test("/h/[id]/duvidas anon vai pro login", async ({ page, request }) => {
    await seed(request);
    await page.goto(`/h/${HACK}/duvidas`);
    await expect(page).toHaveURL(/sign-in|clerk/i, { timeout: 15000 });
  });

  test("aviso seedado não aparece pra anon na página da edição", async ({ page, request }) => {
    await seed(request);
    await page.goto(`/h/${HACK}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "E2E Avisos Jam" })).toBeVisible();
    await expect(page.getByTestId("edition-announcements")).toHaveCount(0);
    await expect(page.getByText(SEEDED_TITLE)).toHaveCount(0);
  });

  test("APIs de avisos, dúvidas e cron respondem 401 JSON", async ({ request }) => {
    await seed(request);
    const calls = [
      request.get(`/api/hackathons/${HACK}/announcements`),
      request.get(`/api/hackathons/${HACK}/questions`),
      request.post(`/api/hackathons/${HACK}/questions`, { data: { body: "invasão" } }),
      request.post(`/api/hackathons/${HACK}/questions/1/answers`, { data: { body: "x" } }),
      request.fetch(`/api/hackathons/${HACK}/questions/1`, { method: "PATCH", data: { resolved: true } }),
      request.get(`/api/admin/hackathons/${HACK}/announcements`),
      request.post(`/api/admin/hackathons/${HACK}/announcements`, {
        data: { audience: "todos", title: "invasão", body: "x" },
      }),
      request.post("/api/cron/deliveries"),
      request.post("/api/cron/deliveries", { headers: { Authorization: "Bearer chute" } }),
      request.post("/api/webhooks/resend", { data: { type: "email.bounced", data: { to: ["a@b.c"] } } }),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status(), res.url()).toBe(401);
      expect(res.headers()["content-type"]).toContain("application/json");
    }
  });

  test("PATCH /api/members/me com telefone exige login", async ({ request }) => {
    const res = await request.fetch("/api/members/me", {
      method: "PATCH",
      data: { phone: "11999999999", whatsappOptIn: true },
    });
    expect(res.status()).toBe(401);
  });
});
