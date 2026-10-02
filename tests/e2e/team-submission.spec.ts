import { expect, test } from "@playwright/test";
import { openE2eDb } from "./db";

// BDD da submissão de time — spec 021. Criar/editar exige login + inscrição
// (Clerk captcha bloqueia automação — ver AGENTS.md), então o teste cobre o
// lado público: anon não vê o formulário na edição e as rotas respondem 401
// JSON (nunca redirect pra sign-in, igual aos outros endpoints).

const HID = "hack-inova-alphaville-2026"; // edição futura ativa (seed)

// idempotente: membro inscrito existir é irrelevante pro anon — mas garante
// que a edição tem dados reais no banco do dev server
function ensureRegistrant() {
  const db = openE2eDb();
  db.pragma("busy_timeout = 5000");
  db.prepare(
    "INSERT OR IGNORE INTO members (clerkId, username, email, name) VALUES ('e2e_teamowner', 'e2e_teamowner', 'e2e-team-owner@t.dev', 'E2E Owner')",
  ).run();
  const m = db
    .prepare("SELECT id FROM members WHERE clerkId = 'e2e_teamowner'")
    .get() as { id: number };
  db.prepare(
    "INSERT OR IGNORE INTO registrations (memberId, hackathonId) VALUES (?, ?)",
  ).run(m.id, HID);
  db.close();
}

test.describe("meu time — submissão self-service na edição", () => {
  test("anon NÃO vê a seção/formulário meu time", async ({ page }) => {
    ensureRegistrant();
    await page.goto(`/h/${HID}`);
    // página pública carrega normal
    await expect(page.getByText("// hackathon")).toBeVisible();
    await expect(page.getByTestId("my-team")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /criar time|submeter time/i }),
    ).toHaveCount(0);
  });

  test("POST deslogado → 401 JSON", async ({ request }) => {
    ensureRegistrant();
    const res = await request.post(`/api/hackathons/${HID}/team`, {
      data: { name: "Time Anon", project: { title: "X" } },
    });
    expect(res.status()).toBe(401);
    expect(res.headers()["content-type"]).toContain("application/json");
  });

  test("PATCH deslogado → 401 JSON; GET deslogado → 401 JSON", async ({
    request,
  }) => {
    ensureRegistrant();
    const patch = await request.patch(`/api/hackathons/${HID}/team`, {
      data: { teamId: 1, title: "x" },
    });
    expect(patch.status()).toBe(401);
    expect(patch.headers()["content-type"]).toContain("application/json");

    const get = await request.get(`/api/hackathons/${HID}/team`);
    expect(get.status()).toBe(401);
    expect(get.headers()["content-type"]).toContain("application/json");
  });
});
