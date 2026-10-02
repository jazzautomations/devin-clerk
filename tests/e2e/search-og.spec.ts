import { expect, test, type APIRequestContext } from "@playwright/test";
import { openE2eDb } from "./db";

// BDD do spec 023 — busca ?q= nas listas públicas + OG dinâmico por edição.

// garante um membro buscável no banco do dev server (mesmo pattern do
// talento.spec.ts): bate /membros primeiro pra forçar o init/migrações do db
async function ensureSearchMember(request: APIRequestContext): Promise<void> {
  await request.get("/membros");
  const db = openE2eDb();
  db.pragma("busy_timeout = 5000");
  db.prepare(
    `INSERT OR IGNORE INTO members (clerkId, username, email)
     VALUES ('e2e_search', 'e2e_search', 'e2e_search@t.dev')`,
  ).run();
  db.prepare(
    `UPDATE members SET name = 'Busca E2E', headline = 'caçadora de edge cases',
       skills = '["rust","wasm"]', xp = 4242
     WHERE clerkId = 'e2e_search'`,
  ).run();
  db.close();
}

test.describe("?q= — busca server-side nas listas públicas", () => {
  test("/radar?q=alphaville estreita pro evento; zzz cai no empty state", async ({
    page,
  }) => {
    await page.goto("/radar?q=alphaville");
    await expect(
      page.getByRole("heading", { name: /hackathons abertos/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /hack inova alphaville/i }),
    ).toBeVisible();

    const res = await page.goto("/radar?q=zzz-nada-a-ver");
    expect(res!.status()).toBe(200);
    await expect(page.locator("article")).toHaveCount(0);
    await expect(page.getByText(/nada no radar/i)).toBeVisible();
  });

  test("form de busca do radar submete via GET e preserva o termo", async ({
    page,
  }) => {
    await page.goto("/radar");
    const input = page.getByRole("searchbox", { name: /buscar/i });
    await input.fill("alphaville");
    await input.press("Enter");
    await expect(page).toHaveURL(/\/radar\?q=alphaville/);
    await expect(input).toHaveValue("alphaville");
  });

  test("/membros?q= filtra por skill/username e preserva o sort", async ({
    page,
    request,
  }) => {
    await ensureSearchMember(request);

    await page.goto("/membros?q=wasm");
    const rows = page.locator("li[data-rank]");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("@e2e_search");

    // sort ativo sobrevive à busca (input hidden no form)
    await page.goto("/membros?sort=recent&q=e2e_search");
    await expect(rows.first()).toContainText("@e2e_search");
    await expect(page.getByLabel(/buscar membros/i)).toHaveValue("e2e_search");

    // curinga SQL é literal: ninguém tem % nos campos → empty state
    await page.goto("/membros?q=%25");
    await expect(page.locator("li[data-rank]")).toHaveCount(0);
    await expect(page.getByText(/nenhum membro/i)).toBeVisible();
  });

  test("/projetos?q= filtra por título e preserva chips de filtro", async ({
    page,
  }) => {
    await page.goto("/projetos?q=hospital");
    await expect(
      page.getByRole("link", { name: "One Day Hospital", exact: true }),
    ).toBeVisible();

    await page.goto("/projetos?q=zzz-nada-a-ver");
    await expect(
      page.getByRole("link", { name: "One Day Hospital", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText(/nenhum projeto/i)).toBeVisible();
  });
});

test.describe("og-image dinâmico — card social por edição", () => {
  test("/h/[id]/opengraph-image responde PNG e a página aponta pra ele", async ({
    page,
    request,
  }) => {
    const img = await request.get(
      "/h/hack-inova-alphaville-2026/opengraph-image",
    );
    expect(img.status()).toBe(200);
    expect(img.headers()["content-type"]).toContain("image/png");

    await page.goto("/h/hack-inova-alphaville-2026");
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
      "content",
      /\/h\/hack-inova-alphaville-2026\/opengraph-image/,
    );
  });

  test("id inexistente responde fallback (200), nunca 500", async ({
    request,
  }) => {
    const img = await request.get("/h/edicao-fantasma-9999/opengraph-image");
    expect(img.status()).toBe(200);
    expect(img.headers()["content-type"]).toContain("image/png");
  });

  test("/p/[teamId]/opengraph-image responde PNG", async ({
    page,
    request,
  }) => {
    await page.goto("/projetos");
    const href = await page
      .getByRole("link", { name: "One Day Hospital", exact: true })
      .first()
      .getAttribute("href");
    expect(href).toMatch(/^\/p\/\d+$/);
    const img = await request.get(`${href}/opengraph-image`);
    expect(img.status()).toBe(200);
    expect(img.headers()["content-type"]).toContain("image/png");
  });
});
