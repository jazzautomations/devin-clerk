import { expect, test, type APIRequestContext } from "@playwright/test";
import { openE2eDb } from "./db";
import { rsvpToken } from "@/lib/rsvp";

// RSVP anti-no-show (migration 012). O link /rsvp/[token] é sem login: o
// e2e seeda um aprovado aguardando confirmação e confirma de verdade pelo
// formulário (sem JavaScript necessário). A aba presença exige login
// (login real é bloqueado pelo captcha do Clerk — caminho logado está nos
// testes de API).
const HACK = "e2e-rsvp-jam";
const SHOTS = process.env.FEAT_J_SHOTS ?? "test-results/feat-j";
const sqlTime = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");

async function seed(request: APIRequestContext, tag: string) {
  await request.get("/radar"); // força init/migrações no server do e2e
  const db = openE2eDb();
  const start = new Date(Date.now() + 10 * 86_400_000);
  await db
    .prepare(
      `INSERT INTO hackathons (id, name, organizer, startsAt, format, location, registrationUrl, tags, active, source, rsvpEnabled)
       VALUES (?, 'E2E RSVP Jam', 'Hack Inova E2E', ?, 'presencial', 'Av. Paulista, 1000 — São Paulo', 'https://e2e.dev/rsvp', '[]', 1, 'e2e', 1)
       ON CONFLICT(id) DO UPDATE SET startsAt = excluded.startsAt, active = 1, rsvpEnabled = 1`,
    )
    .run(HACK, start.toISOString());
  const m = await db
    .prepare(
      `INSERT INTO members (clerkId, username, name, email) VALUES (?, ?, 'Rita Presente', ?)
       ON CONFLICT (clerkId) DO UPDATE SET name = excluded.name RETURNING id`,
    )
    .get<{ id: number }>(`e2e_rsvp_${tag}`, `e2e_rsvp_${tag}`, `rsvp_${tag}@e2e.dev`);
  await db.prepare("DELETE FROM registrations WHERE memberId = ? AND hackathonId = ?").run(m!.id, HACK);
  const deadline = new Date(Date.now() + 3 * 86_400_000);
  const r = await db
    .prepare(
      `INSERT INTO registrations (memberId, hackathonId, status, rsvpStatus, rsvpDeadlineAt)
       VALUES (?, ?, 'approved', 'pending', ?) RETURNING id`,
    )
    .get<{ id: number }>(m!.id, HACK, sqlTime(deadline));
  return { token: rsvpToken(r!.id, deadline), registrationId: r!.id };
}

test.describe("RSVP — link sem login", () => {
  test("token válido seedado: mostra a edição e confirma pelo formulário", async ({ page, request }) => {
    const { token, registrationId } = await seed(request, "ok");
    await page.goto(`/rsvp/${token}`);
    await expect(page.getByRole("heading", { name: "E2E RSVP Jam" })).toBeVisible();
    await expect(page.getByText("Av. Paulista, 1000")).toBeVisible();
    await expect(page.getByTestId("rsvp-status")).toContainText(/responda até/i);
    await page.getByRole("button", { name: "Confirmo, vou" }).click();
    await expect(page.getByTestId("rsvp-done")).toContainText("presença confirmada");
    await expect(page.getByRole("button", { name: "Confirmo, vou" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Não vou mais/ })).toBeVisible();
    const row = await openE2eDb()
      .prepare("SELECT rsvpStatus FROM registrations WHERE id = ?")
      .get<{ rsvpStatus: string }>(registrationId);
    expect(row?.rsvpStatus).toBe("confirmed");
    // idempotente: abrir de novo só mostra o estado
    await page.goto(`/rsvp/${token}`);
    await expect(page.getByTestId("rsvp-status")).toContainText(/presença confirmada/i);
  });

  test("não vou libera a vaga e o link passa a dizer isso", async ({ page, request }) => {
    const { token } = await seed(request, "nao");
    await page.goto(`/rsvp/${token}`);
    await page.getByRole("button", { name: "Não vou — liberar a vaga" }).click();
    await expect(page.getByTestId("rsvp-released")).toContainText("Vaga liberada");
  });

  test("token inválido e token adulterado mostram erro claro", async ({ page, request }) => {
    const { token } = await seed(request, "bad");
    await page.goto("/rsvp/qualquer-coisa");
    await expect(page.getByTestId("rsvp-error")).toHaveText("Link inválido");
    await page.goto(`/rsvp/${token.slice(0, -3)}abc`);
    await expect(page.getByTestId("rsvp-error")).toHaveText("Link inválido");
  });

  test("390px sem scroll horizontal no /rsvp/[token]", async ({ page, request }) => {
    const { token } = await seed(request, "mobile");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/rsvp/${token}`);
    await expect(page.getByTestId("rsvp-page")).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${SHOTS}/rsvp-390.png`, fullPage: true });
    await page.getByRole("button", { name: "Confirmo, vou" }).click();
    await expect(page.getByTestId("rsvp-done")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${SHOTS}/rsvp-confirmado-390.png`, fullPage: true });
    await page.goto("/rsvp/invalido");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `${SHOTS}/rsvp-invalido-390.png`, fullPage: true });
  });
});

test.describe("RSVP — guardas", () => {
  test("aba /admin/h/[id]/presenca exige login", async ({ page, request }) => {
    await seed(request, "guard");
    await page.goto(`/admin/h/${HACK}/presenca`);
    await expect(page).toHaveURL(/sign-in|clerk/i, { timeout: 15000 });
  });

  test("cron e APIs do organizador respondem 401 JSON", async ({ request }) => {
    await seed(request, "api");
    const calls = [
      request.post("/api/cron/rsvp"),
      request.post("/api/cron/rsvp", { headers: { Authorization: "Bearer chute" } }),
      request.get(`/api/admin/hackathons/${HACK}/rsvp`),
      request.put(`/api/admin/hackathons/${HACK}/rsvp`, {
        data: { enabled: true, opensDaysBefore: 7, deadlineDaysBefore: 3, overbookPercent: 0 },
      }),
      request.post(`/api/admin/hackathons/${HACK}/rsvp/resend`, { data: { memberId: 1 } }),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status(), res.url()).toBe(401);
      expect(res.headers()["content-type"]).toContain("application/json");
    }
  });

  test("POST /api/rsvp com token inválido é 404 JSON", async ({ request }) => {
    const res = await request.post("/api/rsvp/lixo", { data: { action: "confirm" } });
    expect(res.status()).toBe(404);
  });
});
