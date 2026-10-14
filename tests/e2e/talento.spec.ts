import { expect } from "@playwright/test";
import { test } from "./auth";
import { openE2eDb } from "./db";

// BDD do diretório /talento — spec 014. Leitura é pública; o opt-in em si é
// PATCH autenticado (coberto em vitest), então o teste seeda membro com
// openTo + time campeão direto no banco do dev server.

const MEMBER = "e2e_talent";

// idempotente: membro opted-in e um time campeão com projeto na 1ª edição
async function ensureTalent(): Promise<void> {
  const db = openE2eDb();
  await db.prepare(
    `INSERT OR IGNORE INTO members (clerkId, username, email)
     VALUES ('e2e_talent', 'e2e_talent', 'e2e_talent@t.dev')`,
  ).run();
  await db.prepare(
    `UPDATE members SET name = 'Talento E2E', persona = 'dev',
       skills = '["typescript","react"]', github = 'e2etalent',
       xp = 9999, openTo = 'trampo,mentoria'
     WHERE clerkId = 'e2e_talent'`,
  ).run();
  // vincula ao time campeão do seed (não cria outro 1º lugar — um segundo
  // placement=1 quebraria o pódio único do arquivo, ver archive.spec.ts)
  let team = await db
    .prepare("SELECT id FROM teams WHERE hackathonId = ? AND name = ?")
    .get("hack-inova-unifacens-2026", "One Day Hospital") as
    | { id: number }
    | undefined;
  if (!team) {
    // fallback p/ banco sem o seed do bootstrap
    const res = await db
      .prepare(
        "INSERT INTO teams (hackathonId, name, placement) VALUES (?, ?, 1)",
      )
      .run("hack-inova-unifacens-2026", "One Day Hospital");
    team = { id: Number(res.lastInsertRowid) };
    await db.prepare(
      "INSERT INTO team_projects (teamId, title, description) VALUES (?, ?, ?)",
    ).run(team.id, "One Day Hospital", "seed e2e");
  }
  await db.prepare(
    "INSERT OR IGNORE INTO team_members (teamId, username) VALUES (?, ?)",
  ).run(team.id, MEMBER);
}

test.describe("talento — diretório de quem constrói de verdade", () => {
  test("/talento é público: heading, chips openTo, prova de entrega", async ({
    memberPage: page,
  }) => {
    await ensureTalent();
    const res = await page.goto("/talento");
    expect(res?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { name: /quem constrói de verdade/i }),
    ).toBeVisible();
    await expect(page.getByText(/contrate quem prova/i)).toBeVisible();

    const row = page.locator("li", { hasText: MEMBER });
    // nome/@username linkam pro perfil público
    await expect(
      row.getByRole("link", { name: /talento e2e/i }),
    ).toHaveAttribute("href", `/u/${MEMBER}`);
    // sinal comercial: chips de openTo
    await expect(row.getByText("trampo", { exact: true })).toBeVisible();
    await expect(row.getByText("mentoria", { exact: true })).toBeVisible();
    // prova: projetos entregues + melhor colocação com a edição
    await expect(row.getByText(/projeto/)).toBeVisible();
    await expect(row.getByText(/1º lugar/)).toBeVisible();
    // skills e github
    await expect(row.getByText("typescript")).toBeVisible();
    await expect(row.getByRole("link", { name: /github/i })).toHaveAttribute(
      "href",
      "https://github.com/e2etalent",
    );
  });

  test("membro sem openTo não aparece — o diretório é opt-in", async ({
    memberPage: page,
  }) => {
    await ensureTalent();
    await page.goto("/talento");
    // jazzautomations existe no dev db sem openTo marcado
    await expect(page.getByText("jazzautomations")).toHaveCount(0);
  });

  test("/perfil (onde se marca open to) exige login", async ({ page }) => {
    await page.goto("/perfil");
    await expect(page).toHaveURL(/sign-in|sign-up|clerk/i, { timeout: 15000 });
  });
});
