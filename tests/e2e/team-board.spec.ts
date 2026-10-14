import { expect } from "@playwright/test";
import { test } from "./auth";
import { openE2eDb } from "./db";

// BDD do board "procuro time" — spec 012. Leitura é pública; anunciar
// exige login + inscrição (Clerk captcha bloqueia automação — ver AGENTS.md),
// então o teste seeda membro+inscrição+anúncio direto no banco do dev
// server e cobre o POST deslogado via request (401).

const HID = "hack-inova-alphaville-2026"; // edição futura ativa (seed)
const NEED = "busco alguém de dados pra fechar o time e2e";

// idempotente: garante membro + inscrição + anúncio, sem duplicar em rerun
async function ensureBoardEntry() {
  const db = openE2eDb();
  await db.prepare(
    "INSERT OR IGNORE INTO members (clerkId, username, email, name, persona, headline) VALUES ('e2e_teamseeker', 'e2e_teamseeker', 'e2e-team@t.dev', 'E2E Seeker', 'dev', 'front que quer time')",
  ).run();
  const m = await db
    .prepare("SELECT id FROM members WHERE clerkId = 'e2e_teamseeker'")
    .get() as { id: number };
  await db.prepare(
    "INSERT OR IGNORE INTO registrations (memberId, hackathonId) VALUES (?, ?)",
  ).run(m.id, HID);
  const has = await db
    .prepare(
      "SELECT 1 FROM looking_for_team WHERE memberId = ? AND hackathonId = ?",
    )
    .get(m.id, HID);
  if (!has) {
    await db.prepare(
      "INSERT INTO looking_for_team (memberId, hackathonId, skills, need, note) VALUES (?, ?, ?, ?, ?)",
    ).run(m.id, HID, '["react","typescript"]', NEED, "nota e2e do board");
  } else {
    await db.prepare(
      "UPDATE looking_for_team SET active = 1, need = ? WHERE memberId = ? AND hackathonId = ?",
    ).run(NEED, m.id, HID);
  }
}

test.describe("procuro time — board público da edição", () => {
  test("membro vê o anúncio seedado na página da edição", async ({ memberPage: page }) => {
    await ensureBoardEntry();
    await page.goto(`/h/${HID}`);
    // seção pública: need, skills, autor linkado pro perfil
    await expect(page.getByText(NEED)).toBeVisible();
    await expect(page.getByText("react").first()).toBeVisible();
    await expect(
      page.getByRole("link", { name: /@e2e_teamseeker/ }).first(),
    ).toHaveAttribute("href", "/u/e2e_teamseeker");
  });

  test("composer é oculto pra quem não tá inscrito", async ({ memberPage: page }) => {
    await ensureBoardEntry();
    await page.goto(`/h/${HID}`);
    await expect(page.getByText(NEED)).toBeVisible();
    // ler é público, anunciar é de inscrito — nenhum composer/toggle
    await expect(
      page.getByRole("button", { name: /procuro time/i }),
    ).toHaveCount(0);
    await expect(page.getByPlaceholder(/o que falta/i)).toHaveCount(0);
  });

  test("POST deslogado → 401 JSON, nunca redirect", async ({ request }) => {
    await ensureBoardEntry();
    const res = await request.post(`/api/hackathons/${HID}/team-board`, {
      data: { need: "dados" },
    });
    expect(res.status()).toBe(401);
    expect(res.headers()["content-type"]).toContain("application/json");
  });
});
