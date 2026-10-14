import { expect, test } from "@playwright/test";
import { openE2eDb } from "./db";

// roadmap 037 #2 (certificado com carga horária) e #9 (feedback do júri pro
// time). Login do Clerk não roda em automação (captcha), então o e2e cobre o
// lado público: verificação com horas/papel/período/instituição, o PDF, a
// página de feedback trancada pra quem não está logado (sem vazar nada
// mesmo com resultado publicado e liberado) e o 401 das APIs.

const H = "e2e-k-horas-feedback";
const CODE = "E2EK0HRS42";
let teamId = 0;

test.beforeAll(async () => {
  const db = openE2eDb();
  await db
    .prepare(
      `INSERT INTO hackathons
         (id, name, organizer, startsAt, endsAt, format, location, registrationUrl, tags, active, source, juryFeedbackReleased)
       VALUES (?, 'E2E Jam de Horas', 'Hack Inova E2E', '2026-09-12 12:00:00', '2026-09-13 21:00:00',
               'presencial', 'São Paulo', 'https://e2e.dev/k', '[]', 1, 'e2e', 1)
       ON CONFLICT(id) DO UPDATE SET juryFeedbackReleased = 1`,
    )
    .run(H);
  await db
    .prepare("INSERT OR IGNORE INTO members (clerkId, username, email, name) VALUES (?, ?, ?, ?)")
    .run("clerk_e2e_k_aluna", "e2e_k_aluna", "e2e_k_aluna@t.dev", "Rita Horas Complementares");
  await db
    .prepare("INSERT OR IGNORE INTO members (clerkId, username, email, name) VALUES (?, ?, ?, ?)")
    .run("clerk_e2e_k_jur", "e2e_k_jur", "e2e_k_jur@t.dev", "Jurado Secreto");
  const aluna = (await db.prepare("SELECT id FROM members WHERE username = 'e2e_k_aluna'").get<{ id: number }>())!.id;
  const jur = (await db.prepare("SELECT id FROM members WHERE username = 'e2e_k_jur'").get<{ id: number }>())!.id;

  await db
    .prepare(
      `INSERT OR IGNORE INTO certificates
         (code, memberId, hackathonId, kind, issuedAt, role, hours, periodStart, periodEnd, institution)
       VALUES (?, ?, ?, 'participacao', '2026-09-14 15:00:00', 'participante', 33,
               '2026-09-12 12:00:00', '2026-09-13 21:00:00', 'Hack Inova + Universidade E2E')`,
    )
    .run(CODE, aluna, H);

  const existing = await db.prepare("SELECT id FROM teams WHERE hackathonId = ? AND name = 'Time K'").get<{ id: number }>(H);
  teamId =
    existing?.id ??
    (await db
      .prepare("INSERT INTO teams (hackathonId, name, placement) VALUES (?, 'Time K', 1) RETURNING id")
      .get<{ id: number }>(H))!.id;
  await db.prepare("INSERT OR IGNORE INTO team_members (teamId, username) VALUES (?, 'e2e_k_aluna')").run(teamId);
  await db
    .prepare("INSERT OR IGNORE INTO team_projects (teamId, title, description) VALUES (?, 'Projeto K', 'descrição')")
    .run(teamId);
  const crit =
    (await db.prepare("SELECT id FROM rubric_criteria WHERE hackathonId = ?").get<{ id: number }>(H)) ??
    (await db
      .prepare("INSERT INTO rubric_criteria (hackathonId, label, weight) VALUES (?, 'Impacto', 1) RETURNING id")
      .get<{ id: number }>(H));
  await db
    .prepare(
      `INSERT OR IGNORE INTO scores (judgeMemberId, teamId, criterionId, score, comment, feedback)
       VALUES (?, ?, ?, 4, 'nota interna E2E', 'comentário anônimo E2E')`,
    )
    .run(jur, teamId, crit!.id);
  await db.prepare("INSERT OR IGNORE INTO jury_results (hackathonId) VALUES (?)").run(H);
});

test.describe("certificado com carga horária — verificação pública", () => {
  test("/c/[code] mostra papel, carga horária, período e instituição", async ({ page }) => {
    await page.goto(`/c/${CODE}`);
    await expect(page.getByRole("heading", { name: "Rita Horas Complementares" })).toBeVisible();
    await expect(page.getByTestId("cert-hours")).toHaveText("33 horas");
    await expect(page.getByText("participante", { exact: true })).toBeVisible();
    await expect(page.getByText(/12 de setembro de 2026 a 13 de setembro de 2026/)).toBeVisible();
    await expect(page.getByText("Hack Inova + Universidade E2E").first()).toBeVisible();
    const linkedin = page.getByRole("link", { name: /adicionar ao linkedin/i });
    await expect(linkedin).toHaveAttribute("href", /linkedin\.com\/profile\/add\?.*organizationName=Hack\+Inova/);
    await expect(linkedin).toHaveAttribute("href", new RegExp(`certId=${CODE}`));
  });

  test("PDF do certificado com horas responde application/pdf", async ({ request }) => {
    const res = await request.get(`/c/${CODE}/pdf`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("application/pdf");
    expect((await res.body()).subarray(0, 5).toString()).toBe("%PDF-");
  });

  test("390px sem scroll horizontal", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/c/${CODE}`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("feedback do júri — trancado pra quem não é do time", () => {
  test("deslogado vê o pedido de login e nenhum comentário, mesmo publicado e liberado", async ({ page }) => {
    const res = await page.goto(`/p/${teamId}/feedback`);
    expect(res?.status()).toBe(200);
    await expect(page.getByTestId("feedback-locked")).toBeVisible();
    await expect(page.getByRole("heading", { name: /entre pra ver o feedback/i })).toBeVisible();
    const html = await page.content();
    expect(html).not.toContain("comentário anônimo E2E");
    expect(html).not.toContain("nota interna E2E");
    expect(html).not.toContain("Jurado Secreto");
  });

  test("ficha pública do projeto não mostra o atalho do feedback pra deslogado", async ({ page }) => {
    await page.goto(`/p/${teamId}`);
    await expect(page.getByRole("heading", { name: "Projeto K" })).toBeVisible();
    await expect(page.getByTestId("feedback-link")).toHaveCount(0);
  });

  test("time inexistente: 404", async ({ page }) => {
    const res = await page.goto("/p/99999999/feedback");
    expect(res?.status()).toBe(404);
  });

  test("390px sem scroll horizontal na página do feedback", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/p/${teamId}/feedback`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("APIs novas — 401 JSON sem login", () => {
  test("feedback do time, configuração/CSV do certificado e liberação do feedback", async ({ request }) => {
    const base = `/api/admin/hackathons/${H}`;
    for (const [method, path, data] of [
      ["GET", `/api/projects/${teamId}/feedback`, undefined],
      ["GET", `${base}/certificados/config`, undefined],
      ["PUT", `${base}/certificados/config`, { hours: { participante: 10 } }],
      ["GET", `${base}/certificados/csv`, undefined],
      ["POST", `${base}/juri/feedback`, { released: false }],
    ] as const) {
      const res = await request.fetch(path, { method, data });
      expect(res.status(), path).toBe(401);
      expect(res.headers()["content-type"]).toContain("application/json");
      expect(await res.json()).toEqual({ error: "Unauthorized" });
    }
  });
});
