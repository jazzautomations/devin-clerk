import { expect } from "@playwright/test";
import { test } from "./auth";
import { openE2eDb } from "./db";

// BDD dos comentários no feed — spec 011. Leitura é pública; escrever
// comentário exige login (Clerk captcha bloqueia automação — ver AGENTS.md),
// então o teste seeda post+thread direto no banco do dev server e cobre o
// POST deslogado via request (401).

const MARKER = "post e2e — thread de comentários";
const C1 = "comentário e2e: primeiro da thread";
const C2 = "comentário e2e: resposta em sequência";

// idempotente: garante membro + post + 2 comentários, sem duplicar em rerun
async function ensureThread(): Promise<number> {
  const db = openE2eDb();
  await db.prepare(
    "INSERT OR IGNORE INTO members (clerkId, username, email, name, persona) VALUES ('e2e_commenter', 'e2e_commenter', 'e2e@t.dev', 'E2E Bot', 'dev')",
  ).run();
  const m = await db
    .prepare("SELECT id FROM members WHERE clerkId = 'e2e_commenter'")
    .get() as { id: number };
  let p = await db.prepare("SELECT id FROM posts WHERE body = ?").get(MARKER) as
    | { id: number }
    | undefined;
  if (!p) {
    await db.prepare("INSERT INTO posts (memberId, body) VALUES (?, ?)").run(
      m.id,
      MARKER,
    );
    p = await db.prepare("SELECT id FROM posts WHERE body = ?").get(MARKER) as {
      id: number;
    };
  }
  for (const body of [C1, C2]) {
    const has = await db
      .prepare(
        "SELECT 1 FROM post_comments WHERE postId = ? AND body = ?",
      )
      .get(p.id, body);
    if (!has) {
      await db.prepare(
        "INSERT INTO post_comments (postId, memberId, body) VALUES (?, ?, ?)",
      ).run(p.id, m.id, body);
    }
  }
  const id = p.id;
  return id;
}

test.describe("comentários — conversa pública no feed", () => {
  test("membro vê a contagem no feed e lê a thread no endereço do post", async ({ memberPage: page }) => {
    const postId = await ensureThread();
    await page.goto("/feed?aba=tudo");
    const post = page.locator("li", { hasText: MARKER });
    // migration 034: a conversa mora em /post/[id]; o feed mostra a contagem
    await expect(post.getByRole("link", { name: /\d+ comentários/ })).toHaveAttribute("href", `/post/${postId}`);
    await page.goto(`/post/${postId}`);
    // thread: ordem cronológica, autor linkado pro perfil
    const thread = page.getByTestId("thread");
    await expect(thread.getByText(C1)).toBeVisible();
    await expect(thread.getByText(C2)).toBeVisible();
    await expect(thread.getByRole("link", { name: "@e2e_commenter" }).first()).toHaveAttribute("href", "/u/e2e_commenter");
  });

  test("anon não lê o feed: vai pro cadastro e volta pro /feed depois (spec 039)", async ({
    page,
  }) => {
    await ensureThread();
    await page.goto("/feed");
    await expect(page).toHaveURL(/\/sign-up\?redirect_url=%2Ffeed/);
    expect(await page.content()).not.toContain(C1);
  });

  test("POST deslogado → 401 JSON, nunca redirect", async ({ request }) => {
    const postId = await ensureThread();
    const res = await request.post(`/api/posts/${postId}/comments`, {
      data: { body: "oi" },
    });
    expect(res.status()).toBe(401);
    expect(res.headers()["content-type"]).toContain("application/json");
  });
});
