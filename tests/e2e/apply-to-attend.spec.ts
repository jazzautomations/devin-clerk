import { expect, test, type APIRequestContext } from "@playwright/test";
import Database from "better-sqlite3";
import { join } from "node:path";

// BDD do spec 032 — edição curada (requiresApproval) troca "inscrever-se em
// 1 clique" por "pedir lugar". Login real é bloqueado pelo captcha (ver
// AGENTS.md), então o e2e cobre o lado público: labels de CTA e 401 JSON.
// A edição é seedada direto no banco do dev server (pattern do spec 027).
const CURATED = "e2e-curada-jam";

async function ensureCuratedEdition(
  request: APIRequestContext,
): Promise<void> {
  // bate /radar primeiro pra forçar o init/migrações do db no dev server
  await request.get("/radar");
  const db = new Database(join(process.cwd(), "data", "hackahub.db"));
  db.pragma("busy_timeout = 5000");
  // a coluna nasce do ALTER guardado em lib/registrations; garante aqui
  // caso o dev server ainda não tenha importado o módulo nesta sessão
  const cols = (
    db.prepare("PRAGMA table_info(hackathons)").all() as { name: string }[]
  ).map((c) => c.name);
  if (!cols.includes("requiresApproval")) {
    db.exec(
      "ALTER TABLE hackathons ADD COLUMN requiresApproval INTEGER NOT NULL DEFAULT 0",
    );
  }
  const regCols = (
    db.prepare("PRAGMA table_info(registrations)").all() as { name: string }[]
  ).map((c) => c.name);
  if (!regCols.includes("status")) {
    db.exec(
      "ALTER TABLE registrations ADD COLUMN status TEXT NOT NULL DEFAULT 'approved'",
    );
  }
  if (!regCols.includes("reviewedAt")) {
    db.exec("ALTER TABLE registrations ADD COLUMN reviewedAt TEXT");
  }
  const future = new Date(Date.now() + 30 * 86_400_000).toISOString();
  // organizer 'Hack Inova' → partner → inscrição inline (não link externo)
  db.prepare(
    `INSERT INTO hackathons
       (id, name, organizer, startsAt, format, registrationUrl,
        tags, active, source, requiresApproval)
     VALUES (?, 'E2E Curada Jam', 'Hack Inova E2E', ?, 'presencial',
             'https://e2e.dev/curada', '[]', 1, 'e2e', 1)
     ON CONFLICT(id) DO UPDATE SET startsAt = excluded.startsAt,
       active = 1, requiresApproval = 1`,
  ).run(CURATED, future);
  db.close();
}

test.describe("edição curada — apply to attend (spec 032)", () => {
  test("card no radar mostra 'pedir lugar' em vez de 'inscrever'", async ({
    page,
    request,
  }) => {
    await ensureCuratedEdition(request);
    await page.goto("/radar?q=curada jam");
    const card = page.locator("article", { hasText: "E2E Curada Jam" });
    await expect(card).toHaveCount(1);
    await expect(
      card.getByRole("button", { name: /pedir lugar/i }),
    ).toBeVisible();
    await expect(
      card.getByRole("button", { name: /inscrever-se em 1 clique/i }),
    ).toHaveCount(0);
  });

  test("página da edição mostra CTA 'pedir lugar' pra anon", async ({
    page,
    request,
  }) => {
    await ensureCuratedEdition(request);
    await page.goto(`/h/${CURATED}`);
    await expect(
      page.getByRole("button", { name: /pedir lugar/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /inscrever-se em 1 clique/i }),
    ).toHaveCount(0);
  });

  test("APIs anon → 401 JSON (register, status, review admin)", async ({
    request,
  }) => {
    await ensureCuratedEdition(request);
    const post = await request.post(
      `/api/hackathons/${CURATED}/register`,
    );
    expect(post.status()).toBe(401);
    expect(post.headers()["content-type"]).toContain("application/json");

    const get = await request.get(`/api/hackathons/${CURATED}/register`);
    expect(get.status()).toBe(401);

    const patch = await request.patch(
      `/api/admin/hackathons/${CURATED}/registrations/1`,
      { data: { action: "approve" } },
    );
    expect(patch.status()).toBe(401);
    expect(patch.headers()["content-type"]).toContain("application/json");
  });
});
