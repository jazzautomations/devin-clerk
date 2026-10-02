import { expect, test, type APIRequestContext } from "@playwright/test";
import Database from "better-sqlite3";
import { join } from "node:path";

// BDD do spec 024 — prêmio vende o clique: card do radar mostra o valor
// em lendário, verbatim. Evento e2e próprio (source='e2e', nunca expira,
// não colide com seeds nem com raspados reais).
const HID = "e2e-prize-jam";
const PRIZE = "R$ 42 mil";

async function ensurePrizeEvent(request: APIRequestContext): Promise<void> {
  // bate /radar primeiro pra forçar o init/migrações do db no dev server
  await request.get("/radar");
  const db = new Database(join(process.cwd(), "data", "hackahub.db"));
  db.pragma("busy_timeout = 5000");
  const cols = (
    db.prepare("PRAGMA table_info(hackathons)").all() as { name: string }[]
  ).map((c) => c.name);
  if (!cols.includes("prize")) {
    db.exec("ALTER TABLE hackathons ADD COLUMN prize TEXT");
  }
  db.prepare(
    `INSERT INTO hackathons
       (id, name, organizer, startsAt, format, registrationUrl, tags,
        active, source, prize)
     VALUES (?, 'E2E Prize Jam', 'E2E Org', '2099-05-01T09:00:00-03:00',
             'online', 'https://e2e.dev/jam', '[]', 1, 'e2e', ?)
     ON CONFLICT(id) DO UPDATE SET prize = excluded.prize, active = 1`,
  ).run(HID, PRIZE);
  db.close();
}

test.describe("prêmio nos cards — spec 024", () => {
  test("card do radar mostra o prêmio em lendário, verbatim", async ({
    page,
    request,
  }) => {
    await ensurePrizeEvent(request);
    await page.goto("/radar?q=prize jam");
    const card = page.locator("article", { hasText: "E2E Prize Jam" });
    await expect(card).toHaveCount(1);
    const chip = card.getByText(PRIZE, { exact: true });
    await expect(chip).toBeVisible();
    await expect(chip).toHaveClass(/text-lendario/);
  });

  test("card sem prêmio não renderiza a linha", async ({ page }) => {
    await page.goto("/radar?q=alphaville");
    const card = page.locator("article", {
      hasText: "Hack Inova Alphaville",
    });
    await expect(card).toHaveCount(1);
    await expect(card.getByText("prêmio")).toHaveCount(0);
  });

  test("OG de edição com prêmio continua 200 PNG", async ({ request }) => {
    await ensurePrizeEvent(request);
    const img = await request.get(`/h/${HID}/opengraph-image`);
    expect(img.status()).toBe(200);
    expect(img.headers()["content-type"]).toContain("image/png");
  });
});
