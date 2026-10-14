import { expect, test } from "@playwright/test";
import { openE2eDb } from "./db";

// BDD do mural da edição — spec 028. Leitura é pública; postar no mural
// exige inscrição (Clerk captcha bloqueia automação — ver AGENTS.md),
// então o teste seeda post escopado direto no banco do dev server e cobre
// os guards via request (401/404).

const ED = "hack-inova-alphaville-2026";
const ED_NAME = "Hack Inova Alphaville";
const MARKER = "post e2e — mural da edição";

// idempotente: garante membro + post escopado, sem duplicar em rerun
async function ensureEditionPost(): Promise<void> {
  const db = openE2eDb();
  await db.prepare(
    "INSERT OR IGNORE INTO members (clerkId, username, email, name) VALUES ('e2e_mural', 'e2e_mural', 'e2e_mural@t.dev', 'E2E Mural')",
  ).run();
  const m = await db
    .prepare("SELECT id FROM members WHERE clerkId = 'e2e_mural'")
    .get() as { id: number };
  const has = await db.prepare("SELECT 1 FROM posts WHERE body = ?").get(MARKER);
  if (!has) {
    await db.prepare(
      "INSERT INTO posts (memberId, body, hackathonId) VALUES (?, ?, ?)",
    ).run(m.id, MARKER, ED);
  }
}

test.describe("mural da edição — atividade viva em /h/[id]", () => {
  test("página da edição mostra a seção e os posts escopados", async ({
    page,
  }) => {
    await ensureEditionPost();
    await page.goto(`/h/${ED}`);
    await expect(
      page.getByRole("heading", { name: /mural da edição/i }),
    ).toBeVisible();
    await expect(page.getByText(MARKER)).toBeVisible();
  });

  test("anon lê o mural mas não vê composer — postar é de inscrito", async ({
    page,
  }) => {
    await ensureEditionPost();
    await page.goto(`/h/${ED}`);
    await expect(page.getByText(MARKER)).toBeVisible();
    await expect(page.getByPlaceholder(/construindo/i)).toHaveCount(0);
    await expect(page.getByText(/só inscritos postam/i)).toBeVisible();
  });

  test("post escopado aparece no /feed com chip linkando a edição", async ({
    page,
  }) => {
    await ensureEditionPost();
    await page.goto("/feed");
    const post = page.locator("li", { hasText: MARKER });
    const chip = post.getByRole("link", { name: `→ ${ED_NAME}` });
    await expect(chip).toHaveAttribute("href", `/h/${ED}`);
  });

  test("POST anon com hackathonId → 401 JSON; GET ?h= filtra a edição", async ({
    request,
  }) => {
    await ensureEditionPost();
    const res = await request.post("/api/posts", {
      data: { body: "oi", hackathonId: ED },
    });
    expect(res.status()).toBe(401);
    expect(res.headers()["content-type"]).toContain("application/json");

    const scoped = await request.get(`/api/posts?h=${ED}`);
    expect(scoped.status()).toBe(200);
    const { posts } = await scoped.json();
    expect(posts.some((p: { body: string }) => p.body === MARKER)).toBe(true);
    expect(
      posts.every((p: { hackathonId: string | null }) => p.hackathonId === ED),
    ).toBe(true);

    const nf = await request.get("/api/posts?h=nope-404");
    expect(nf.status()).toBe(404);
  });
});
