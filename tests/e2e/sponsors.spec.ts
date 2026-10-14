import { expect, test } from "@playwright/test";
import { openE2eDb } from "./db";

// BDD do CRM de sponsors — spec 019. O vínculo desafio→sponsor via API exige
// admin logado (Clerk captcha bloqueia automação — ver AGENTS.md), então o
// teste seeda sponsor+desafio vinculado direto no banco do dev server e cobre
// as rotas admin deslogadas via request (401).

// edição com seed de desafio só-texto — NÃO usar alphaville: challenges.spec
// asserta que ela segue sem a seção (inventário vazio não renderiza)
const HID = "hack-inova-puc-saude-2026";
const SPONSOR_URL = "https://e2e-sponsor.dev";
const SPONSOR_NAME = "E2E Master Co";
const CHAL_ID = "e2e-chal-sponsored";

// idempotente: garante tabela sponsors + coluna sponsorId + vínculo,
// espelhando o schema de lib/sponsors.ts (o dev server também cria no import)
async function ensureLinkedChallenge() {
  const db = openE2eDb();
  await db.prepare(
    `INSERT INTO sponsors (id, name, url, tier, active)
     VALUES ('e2e-sponsor', ?, ?, 'master', 1)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name,
       url = excluded.url, tier = 'master', active = 1`,
  ).run(SPONSOR_NAME, SPONSOR_URL);
  const has = await db
    .prepare("SELECT 1 FROM challenges WHERE id = ?")
    .get(CHAL_ID);
  if (!has) {
    await db.prepare(
      `INSERT INTO challenges (id, hackathonId, sponsor, title, prize, sponsorId, active)
       VALUES (?, ?, ?, ?, ?, 'e2e-sponsor', 1)`,
    ).run(
      CHAL_ID,
      HID,
      SPONSOR_NAME,
      "Desafio e2e patrocinado",
      "vaga + badge master",
    );
  } else {
    await db.prepare(
      `UPDATE challenges SET sponsorId = 'e2e-sponsor', sponsor = ?, active = 1
       WHERE id = ?`,
    ).run(SPONSOR_NAME, CHAL_ID);
  }
}

test.describe("sponsors — CRM de marcas na página pública", () => {
  test("desafio vinculado mostra nome do sponsor como link + chip de tier", async ({
    page,
  }) => {
    await ensureLinkedChallenge();
    await page.goto(`/h/${HID}`);
    await expect(page.getByText(/desafios patrocinados/i)).toBeVisible();
    // marca é link externo pro site do sponsor — inventário clicável
    const link = page.getByRole("link", { name: SPONSOR_NAME });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", SPONSOR_URL);
    // chip de tier master ao lado do nome
    const card = page.locator("li", { has: link });
    await expect(card.getByText("master", { exact: true })).toBeVisible();
    await expect(
      card.getByRole("heading", { name: /desafio e2e patrocinado/i }),
    ).toBeVisible();
  });

  test("desafio só-texto (seed) continua sem link nem chip", async ({
    page,
  }) => {
    await page.goto("/h/hack-inova-puc-saude-2026");
    // seed Oracle é texto puro — nenhum link "Oracle" nem chip de tier
    await expect(
      page.getByRole("link", { name: "Oracle", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText("Oracle", { exact: true })).toBeVisible();
  });

  test("APIs de sponsor trancadas sem login → 401 JSON", async ({
    request,
  }) => {
    await ensureLinkedChallenge();
    const get = await request.get("/api/admin/sponsors");
    expect(get.status()).toBe(401);
    expect(get.headers()["content-type"]).toContain("application/json");
    const post = await request.post("/api/admin/sponsors", {
      data: { name: "X" },
    });
    expect(post.status()).toBe(401);
    const patch = await request.fetch("/api/admin/sponsors/e2e-sponsor", {
      method: "PATCH",
      data: { active: false },
    });
    expect(patch.status()).toBe(401);
  });
});
