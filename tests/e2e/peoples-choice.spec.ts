import { expect } from "@playwright/test";
import { test } from "./auth";
import { openE2eDb } from "./db";

// BDD da escolha do povo — spec 025. Votar exige login (Clerk captcha bloqueia
// automação — ver AGENTS.md), então o e2e cobre o lado público: placar ▲ nos
// cards, chip de ordenação, 401 JSON no POST anon e clique da ficha → sign-in.

const HACK = "hack-inova-unifacens-2026"; // seed: One Day Hospital, 1º lugar

// teamId real do seed — a ficha /p/[teamId] e a rota de voto dependem dele
async function seedTeamId(): Promise<number> {
  const db = openE2eDb();
  const t = await db
    .prepare("SELECT id FROM teams WHERE hackathonId = ? AND name = ?")
    .get(HACK, "One Day Hospital") as { id: number };
  return t.id;
}

test.describe("escolha do povo — voto da comunidade", () => {
  test("card do /projetos mostra o placar ▲ N mesmo deslogado", async ({
    memberPage: page,
  }) => {
    await page.goto("/projetos");
    const card = page.locator("li", { hasText: "One Day Hospital" });
    await expect(card.getByText(/^▲ \d+$/)).toBeVisible();
  });

  test("chip 'escolha do povo' ordena por votos e volta pro júri", async ({
    memberPage: page,
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
    const res = await request.post(`/api/projects/${await seedTeamId()}/vote`);
    expect(res.status()).toBe(401);
    expect(res.headers()["content-type"]).toContain("application/json");
  });

  test("ficha /p/[teamId]: membro vê o botão ▲; anon vê o cartão com CTA de cadastro", async ({
    page,
    memberPage,
  }) => {
    const id = await seedTeamId();
    await memberPage.goto(`/p/${id}`);
    await expect(memberPage.getByRole("button", { name: /escolha do povo/i })).toBeVisible();
    // spec 039 — sem conta: cartão mínimo, sem voto, e o CTA volta pra ficha
    await page.goto(`/p/${id}`);
    await expect(page.getByTestId("public-card")).toBeVisible();
    await expect(page.getByRole("button", { name: /escolha do povo/i })).toHaveCount(0);
    await expect(page.getByTestId("public-card-cta")).toHaveAttribute("href", `/sign-up?redirect_url=%2Fp%2F${id}`);
  });
});
