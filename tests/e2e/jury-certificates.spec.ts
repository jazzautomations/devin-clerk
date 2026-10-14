import { expect, test } from "@playwright/test";
import { openE2eDb } from "./db";

// BDD do júri + certificado verificável — spec 033 US5/US6. Avaliar e emitir
// exigem login (Clerk captcha bloqueia automação), então o e2e cobre o lado
// público: a verificação /c/[code], o PDF e as portas trancadas.

const HACK = "hack-inova-alphaville-2026";
const CODE = "E2E7C3RT9K";

test.beforeAll(async () => {
  const db = openE2eDb();
  await db
    .prepare("INSERT OR IGNORE INTO members (clerkId, username, email, name) VALUES (?, ?, ?, ?)")
    .run("clerk_e2e_cert", "e2e_cert", "e2e_cert@t.dev", "Joana Certificada");
  const m = await db.prepare("SELECT id FROM members WHERE username = ?").get<{ id: number }>("e2e_cert");
  await db
    .prepare(
      `INSERT OR IGNORE INTO certificates (code, memberId, hackathonId, kind, detail, issuedAt)
       VALUES (?, ?, ?, 'premiacao', '1º lugar com o time E2E', '2026-10-10 18:00:00')`,
    )
    .run(CODE, m!.id, HACK);
});

test.describe("certificado — verificação pública", () => {
  test("/c/[code] mostra nome, edição, tipo e data sem login", async ({ page }) => {
    await page.goto(`/c/${CODE}`);
    await expect(page.getByRole("heading", { name: "Joana Certificada" })).toBeVisible();
    await expect(page.getByText(/certificado válido/i)).toBeVisible();
    await expect(page.getByText(/premiação/i).first()).toBeVisible();
    await expect(page.getByText("1º lugar com o time E2E")).toBeVisible();
    await expect(page.getByText(/10 de outubro de 2026/)).toBeVisible();
    await expect(page.getByRole("link", { name: /baixar pdf/i })).toHaveAttribute("href", `/c/${CODE}/pdf`);
  });

  test("código em minúsculo também valida", async ({ page }) => {
    await page.goto(`/c/${CODE.toLowerCase()}`);
    await expect(page.getByRole("heading", { name: "Joana Certificada" })).toBeVisible();
  });

  test("/c/inexistente responde 404", async ({ page }) => {
    const res = await page.goto("/c/inexistente");
    expect(res?.status()).toBe(404);
  });

  test("/c/[code]/pdf responde application/pdf", async ({ request }) => {
    const res = await request.get(`/c/${CODE}/pdf`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("application/pdf");
    expect((await res.body()).subarray(0, 5).toString()).toBe("%PDF-");
    expect((await request.get("/c/NAOEXISTE0/pdf")).status()).toBe(404);
  });

  test("390px sem scroll horizontal na verificação", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/c/${CODE}`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe("júri — portas trancadas sem login", () => {
  test("aba /admin/h/[id]/juri exige login", async ({ page }) => {
    await page.goto(`/admin/h/${HACK}/juri`);
    await expect(page).toHaveURL(/sign-in|clerk/i, { timeout: 15000 });
  });

  test("APIs do júri e dos certificados respondem 401 JSON", async ({ request }) => {
    const base = `/api/admin/hackathons/${HACK}`;
    for (const [method, path, data] of [
      ["POST", `${base}/juri/criteria`, { label: "x", weight: 1 }],
      ["POST", `${base}/juri/assignments`, { all: true }],
      ["POST", `${base}/juri/scores`, { teamId: 1, scores: [] }],
      ["GET", `${base}/juri/ranking`, undefined],
      ["POST", `${base}/juri/publish`, undefined],
      ["POST", `${base}/certificados`, undefined],
    ] as const) {
      const res = await request.fetch(path, { method, data });
      expect(res.status(), path).toBe(401);
      expect(res.headers()["content-type"]).toContain("application/json");
    }
  });
});
