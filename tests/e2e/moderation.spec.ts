import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import { join } from "node:path";

// BDD da moderação — spec 018. Apagar exige login (Clerk captcha bloqueia
// automação — ver AGENTS.md), então o e2e cobre o contrato anon: DELETE
// deslogado → 401 JSON nos dois endpoints, e o controle "apagar" não aparece
// pra visitante nem em post seedado no banco do dev server.

const MARKER = "post e2e — alvo de moderação";

function ensurePost(): number {
  const db = new Database(join(process.cwd(), "data", "hackahub.db"));
  db.pragma("busy_timeout = 5000");
  db.prepare(
    "INSERT OR IGNORE INTO members (clerkId, username, email) VALUES ('e2e_commenter', 'e2e_commenter', 'e2e@t.dev')",
  ).run();
  const m = db
    .prepare("SELECT id FROM members WHERE clerkId = 'e2e_commenter'")
    .get() as { id: number };
  let p = db.prepare("SELECT id FROM posts WHERE body = ?").get(MARKER) as
    | { id: number }
    | undefined;
  if (!p) {
    db.prepare("INSERT INTO posts (memberId, body) VALUES (?, ?)").run(
      m.id,
      MARKER,
    );
    p = db.prepare("SELECT id FROM posts WHERE body = ?").get(MARKER) as {
      id: number;
    };
  }
  const id = p.id;
  db.close();
  return id;
}

test.describe("moderação — visitante não apaga nada", () => {
  test("DELETE /api/posts/[id] deslogado → 401 JSON, nunca redirect", async ({
    request,
  }) => {
    const postId = ensurePost();
    const res = await request.delete(`/api/posts/${postId}`);
    expect(res.status()).toBe(401);
    expect(res.headers()["content-type"]).toContain("application/json");
    // e o post segue lá — anon não pode tirar nada do ar
    const list = await request.get("/api/posts");
    const { posts } = await list.json();
    expect(posts.some((p: { id: number }) => p.id === postId)).toBe(true);
  });

  test("DELETE comentário deslogado → 401 JSON", async ({ request }) => {
    const postId = ensurePost();
    const res = await request.delete(`/api/posts/${postId}/comments/1`);
    expect(res.status()).toBe(401);
    expect(res.headers()["content-type"]).toContain("application/json");
  });

  test("anon não vê controle de apagar no feed", async ({ page }) => {
    ensurePost();
    await page.goto("/feed");
    const post = page.locator("li", { hasText: MARKER });
    await expect(post).toBeVisible();
    await expect(
      page.getByRole("button", { name: /apagar/i }),
    ).toHaveCount(0);
  });
});
