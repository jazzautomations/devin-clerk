import { expect, test } from "@playwright/test";
import { openE2eDb } from "./db";

// BDD dos avatares — spec 020. Leitura pública: membro com avatarUrl (foto
// do Clerk) renderiza <img>; sem foto renderiza o bloco de iniciais. Seed
// direto no banco do dev server, idempotente pra rerun.

const AVATAR_URL = "https://img.clerk.com/e2e-avatar.png";
const POST_COM = "post e2e — autor com avatar";
const POST_SEM = "post e2e — autor sem avatar";

async function ensureAvatarPosts() {
  const db = openE2eDb();
  await db.prepare(
    `INSERT OR IGNORE INTO members (clerkId, username, email, name, avatarUrl)
     VALUES ('e2e_avatar', 'e2e_avatar', 'e2e_avatar@t.dev', 'Ada Avatar', ?)`,
  ).run(AVATAR_URL);
  await db.prepare(
    `INSERT OR IGNORE INTO members (clerkId, username, email, name)
     VALUES ('e2e_noavatar', 'e2e_noavatar', 'e2e_noavatar@t.dev', 'Sem Foto')`,
  ).run();
  // garante a foto mesmo se o membro já existia de um rerun antigo
  await db.prepare("UPDATE members SET avatarUrl = ? WHERE clerkId = 'e2e_avatar'").run(
    AVATAR_URL,
  );
  for (const [clerkId, body] of [
    ["e2e_avatar", POST_COM],
    ["e2e_noavatar", POST_SEM],
  ] as const) {
    const m = await db
      .prepare("SELECT id FROM members WHERE clerkId = ?")
      .get(clerkId) as { id: number };
    const has = await db.prepare("SELECT 1 FROM posts WHERE body = ?").get(body);
    if (!has) {
      await db.prepare("INSERT INTO posts (memberId, body) VALUES (?, ?)").run(
        m.id,
        body,
      );
    }
  }
}

test.describe("avatares — a cara de quem constrói", () => {
  test("post de membro com avatarUrl renderiza a imagem no feed", async ({
    page,
  }) => {
    await ensureAvatarPosts();
    await page.goto("/feed");
    const post = page.locator("li", { hasText: POST_COM });
    await expect(post).toBeVisible();
    const img = post.locator("img[data-avatar]");
    await expect(img).toBeVisible();
    await expect(img).toHaveAttribute("src", AVATAR_URL);
  });

  test("membro sem foto cai pro bloco de iniciais — nunca img quebrada", async ({
    page,
  }) => {
    await ensureAvatarPosts();
    await page.goto("/feed");
    const post = page.locator("li", { hasText: POST_SEM });
    await expect(post).toBeVisible();
    // "Sem Foto" → SF; span de iniciais, não <img>
    await expect(post.locator("img[data-avatar]")).toHaveCount(0);
    await expect(post.locator("span[data-avatar]")).toHaveText("SF");
  });

  test("perfil público mostra o avatar grande no cabeçalho", async ({
    page,
  }) => {
    await ensureAvatarPosts();
    await page.goto("/u/e2e_avatar");
    const img = page.locator("img[data-avatar]").first();
    await expect(img).toBeVisible();
    await expect(img).toHaveAttribute("src", AVATAR_URL);
  });

  test("perfil público sem foto mostra iniciais grandes", async ({ page }) => {
    await ensureAvatarPosts();
    await page.goto("/u/e2e_noavatar");
    await expect(page.locator("span[data-avatar]").first()).toHaveText("SF");
  });
});
