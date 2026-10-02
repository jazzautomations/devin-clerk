import { expect, test } from "@playwright/test";
import { openE2eDb } from "./db";

// BDD da escolha do povo — spec 025. Votar exige login (Clerk captcha bloqueia
// automação — ver AGENTS.md), então o e2e cobre o lado público: placar ▲ nos
// cards, chip de ordenação, 401 JSON no POST anon e clique da ficha → sign-in.

const HACK = "hack-inova-unifacens-2026"; // seed: One Day Hospital, 1º lugar

// teamId real do seed — a ficha /p/[teamId] e a rota de voto dependem dele
function seedTeamId(): number {
  const db = openE2eDb();
  db.pragma("busy_timeout = 5000");
  const t = db
    .prepare("SELECT id FROM teams WHERE hackathonId = ? AND name = ?")
    .get(HACK, "One Day Hospital") as { id: number };
  db.close();
  return t.id;
}

test.describe("escolha do povo — voto da comunidade", () => {
  test("card do /projetos mostra o placar ▲ N mesmo deslogado", async ({
    page,
  }) => {
    await page.goto("/projetos");
    const card = page.locator("li", { hasText: "One Day Hospital" });
    await expect(card.getByText(/^▲ \d+$/)).toBeVisible();
  });

  test("chip 'escolha do povo' ordena por votos e volta pro júri", async ({
    page,
  }) => {
    await page.goto("/projetos");
    const chip = page.getByRole("link", { name: /escolha do povo/i });
    await expect(chip).toBeVisible();

    await chip.click();
    await expect(page).toHaveURL(/\/projetos\?.*sort=votes/);

    // clicar de novo desliga o sort — volta pra ordenação do júri
    await page.getByRole("link", { name: /escolha do povo/i }).click();
    await expect(page).not.toHaveURL(/sort=votes/);
  });

  test("POST /api/projects/[teamId]/vote deslogado → 401 JSON", async ({
    request,
  }) => {
    const res = await request.post(`/api/projects/${seedTeamId()}/vote`);
    expect(res.status()).toBe(401);
    expect(res.headers()["content-type"]).toContain("application/json");
  });

  test("ficha /p/[teamId] tem o botão ▲ e o clique anon leva pro sign-in", async ({
    page,
  }) => {
    await page.goto(`/p/${seedTeamId()}`);
    const btn = page.getByRole("button", { name: /escolha do povo/i });
    await expect(btn).toBeVisible();
    // hydration race: o primeiro clique pode cair antes do hidratar no dev —
    // repete até o router.push("/sign-in") pegar
    await expect(async () => {
      await btn.click();
      await expect(page).toHaveURL(/\/sign-in/, { timeout: 3000 });
    }).toPass({ timeout: 20000 });
  });
});
