import { expect, type APIRequestContext } from "@playwright/test";
import { test } from "./auth";
import { openE2eDb } from "./db";

// BDD do spec 032 — edição curada (requiresApproval) troca "inscrever-se em
// 1 clique" por "pedir lugar". Login real é bloqueado pelo captcha (ver
// AGENTS.md), então o e2e cobre o lado público: labels de CTA e 401 JSON.
// A edição é seedada direto no banco do dev server (pattern do spec 027).
const CURATED = "e2e-curada-jam";

async function ensureCuratedEdition(
  request: APIRequestContext,
): Promise<void> {
  // bate /radar primeiro pra forçar o init/migrações do db no dev server
  await request.get("/api/health");
  const db = openE2eDb();
  const future = new Date(Date.now() + 30 * 86_400_000).toISOString();
  // organizer 'Hack Inova' → partner → inscrição inline (não link externo)
  await db.prepare(
    `INSERT INTO hackathons
       (id, name, organizer, startsAt, format, registrationUrl,
        tags, active, source, requiresApproval)
     VALUES (?, 'E2E Curada Jam', 'Hack Inova E2E', ?, 'presencial',
             'https://e2e.dev/curada', '[]', 1, 'e2e', 1)
     ON CONFLICT(id) DO UPDATE SET startsAt = excluded.startsAt,
       active = 1, requiresApproval = 1`,
  ).run(CURATED, future);
}

test.describe("edição curada — apply to attend (spec 032)", () => {
  test("card no radar mostra 'pedir lugar' em vez de 'inscrever'", async ({
    memberPage: page,
    request,
  }) => {
    await ensureCuratedEdition(request);
    // o request.get acima já aqueceu o compile da rota; domcontentloaded
    // evita depender do 'load' (scripts externos lentos/flaky)
    await page.goto("/radar?q=curada jam", { waitUntil: "domcontentloaded" });
    const card = page.locator("article", { hasText: "E2E Curada Jam" });
    await expect(card).toHaveCount(1);
    await expect(
      card.getByRole("button", { name: /pedir lugar/i }),
    ).toBeVisible();
    await expect(
      card.getByRole("button", { name: /inscrever-se em 1 clique/i }),
    ).toHaveCount(0);
  });

  test("página da edição mostra CTA 'pedir lugar' pra membro sem inscrição", async ({
    memberPage: page,
    request,
  }) => {
    await ensureCuratedEdition(request);
    await page.goto(`/h/${CURATED}`);
    // frente L: toda inscrição passa pelo formulário (nascimento, conduta)
    await expect(
      page.getByRole("link", { name: /pedir lugar/i }),
    ).toHaveAttribute("href", `/h/${CURATED}/inscricao`);
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
