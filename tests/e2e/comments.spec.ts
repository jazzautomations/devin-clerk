import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";
import { join } from "node:path";

// BDD dos comentários no feed — spec 011. Leitura é pública; escrever
// comentário exige login (Clerk captcha bloqueia automação — ver AGENTS.md),
// então o teste seeda post+thread direto no banco do dev server e cobre o
// POST deslogado via request (401).

const MARKER = "post e2e — thread de comentários";
const C1 = "comentário e2e: primeiro da thread";
const C2 = "comentário e2e: resposta em sequência";

// idempotente: garante membro + post + 2 comentários, sem duplicar em rerun
function ensureThread(): number {
  const db = new Database(join(process.cwd(), "data", "hackahub.db"));
  db.pragma("busy_timeout = 5000");
  db.exec(`CREATE TABLE IF NOT EXISTS post_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    postId INTEGER NOT NULL REFERENCES posts(id),
    memberId INTEGER NOT NULL REFERENCES members(id),
    body TEXT NOT NULL,
    createdAt TEXT NOT NULL DEFAULT (datetime('now'))
  );`);
  db.prepare(
    "INSERT OR IGNORE INTO members (clerkId, username, email, name, persona) VALUES ('e2e_commenter', 'e2e_commenter', 'e2e@t.dev', 'E2E Bot', 'dev')",
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
  for (const body of [C1, C2]) {
    const has = db
      .prepare(
        "SELECT 1 FROM post_comments WHERE postId = ? AND body = ?",
      )
      .get(p.id, body);
    if (!has) {
      db.prepare(
        "INSERT INTO post_comments (postId, memberId, body) VALUES (?, ?, ?)",
      ).run(p.id, m.id, body);
    }
  }
  const id = p.id;
  db.close();
  return id;
}

// expandir exige React hidratado; em dev frio o primeiro clique pode cair
// antes da hidratação — retenta até a thread abrir (toggle é idempotente:
// clique extra fecha, próximo reabre com cache, converge rápido)
async function expandThread(
  page: import("@playwright/test").Page,
): Promise<ReturnType<import("@playwright/test").Page["locator"]>> {
  const post = page.locator("li", { hasText: MARKER });
  const toggle = post.getByRole("button", { name: /comentários/i });
  await expect(toggle).toBeVisible();
  for (let i = 0; i < 8; i++) {
    await toggle.click();
    try {
      await expect(post.getByText(C1)).toBeVisible({ timeout: 2000 });
      return post;
    } catch {
      // clique caiu antes da hidratação ou fechou — tenta de novo
    }
  }
  await expect(post.getByText(C1)).toBeVisible();
  return post;
}

test.describe("comentários — conversa pública no feed", () => {
  test("anon vê a contagem e lê a thread expandida", async ({ page }) => {
    ensureThread();
    await page.goto("/feed");
    const post = await expandThread(page);
    // thread pública: ordem cronológica, autor linkado pro perfil
    await expect(post.getByText(C1)).toBeVisible();
    await expect(post.getByText(C2)).toBeVisible();
    await expect(
      post.getByRole("link", { name: "@e2e_commenter" }).first(),
    ).toHaveAttribute("href", "/u/e2e_commenter");
  });

  test("composer de comentário é oculto pra quem não tá logado", async ({
    page,
  }) => {
    ensureThread();
    await page.goto("/feed");
    const post = await expandThread(page);
    await expect(post.getByText(C1)).toBeVisible();
    // ler é público, escrever é de membro — nenhuma caixa de comentário
    await expect(post.getByPlaceholder(/comenta/i)).toHaveCount(0);
  });

  test("POST deslogado → 401 JSON, nunca redirect", async ({ request }) => {
    const postId = ensureThread();
    const res = await request.post(`/api/posts/${postId}/comments`, {
      data: { body: "oi" },
    });
    expect(res.status()).toBe(401);
    expect(res.headers()["content-type"]).toContain("application/json");
  });
});
