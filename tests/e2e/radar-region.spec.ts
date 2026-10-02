import { expect, test, type APIRequestContext } from "@playwright/test";
import { openE2eDb } from "./db";

// Filtro "onde" do radar — chips de UF/bucket derivados do texto livre de
// location. Eventos próprios (source='e2e', janelas futuras) não colidem
// com seed nem raspados reais.
const PE = "e2e-recife-jam";
const ONLINE = "e2e-online-jam";
const EXTERIOR = "e2e-lisbon-jam";

async function ensureRegionEvents(request: APIRequestContext) {
  // bate /radar primeiro pra forçar o init/migrações do db no server
  await request.get("/radar");
  const db = openE2eDb();
  db.pragma("busy_timeout = 5000");
  const day = 86_400_000;
  const future = new Date(Date.now() + 30 * day).toISOString();
  const insert = db.prepare(
    `INSERT INTO hackathons
       (id, name, organizer, startsAt, format, location, registrationUrl,
        tags, active, source)
     VALUES (?, ?, 'E2E Org', ?, ?, ?, 'https://e2e.dev/x', '[]', 1, 'e2e')
     ON CONFLICT(id) DO UPDATE SET startsAt = excluded.startsAt,
       location = excluded.location, active = 1`,
  );
  insert.run(PE, "E2E Recife Jam", future, "presencial", "Recife, PE");
  insert.run(ONLINE, "E2E Online Jam", future, "online", null);
  insert.run(EXTERIOR, "E2E Lisbon Jam", future, "presencial", "Lisboa, Portugal");
  db.close();
}

test.describe("radar — filtro por localização", () => {
  test("linha 'onde' lista as regiões presentes e filtra por UF", async ({
    page,
    request,
  }) => {
    await ensureRegionEvents(request);
    await page.goto("/radar");
    // a linha "onde" existe nas duas seções (sessões + radar) — a do radar
    // é a segunda e é onde os eventos e2e caem
    const onde = page.getByText("onde:", { exact: true }).last().locator("..");
    await expect(onde.getByRole("button", { name: "pe" })).toBeVisible();
    await expect(
      onde.getByRole("button", { name: "online" }),
    ).toBeVisible();
    await expect(
      onde.getByRole("button", { name: "exterior" }),
    ).toBeVisible();

    await onde.getByRole("button", { name: "pe" }).click();
    await expect(
      page.locator("article", { hasText: "E2E Recife Jam" }),
    ).toHaveCount(1);
    await expect(
      page.locator("article", { hasText: "E2E Online Jam" }),
    ).toHaveCount(0);
    await expect(
      page.locator("article", { hasText: "E2E Lisbon Jam" }),
    ).toHaveCount(0);

    // toggle do mesmo chip limpa o filtro
    await onde.getByRole("button", { name: "pe" }).click();
    await expect(
      page.locator("article", { hasText: "E2E Online Jam" }),
    ).toHaveCount(1);
  });
});
