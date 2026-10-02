import { expect, test } from "@playwright/test";

// BDD das notificações — spec 013. O sino só existe pra membro logado e o
// Clerk captcha bloqueia signup automatizado (ver AGENTS.md), então o e2e
// cobre o que é público: sino ausente pra visitante + API 401 sem sessão.
// O fluxo logado (badge → dropdown → marcar lido) fica pro teste manual
// do usuário no tunnel público, coberto por vitest na API/lib.

test.describe("notificações — sino é privilégio de membro", () => {
  test("visitante navega sem sino no header", async ({ page }) => {
    for (const path of ["/", "/feed", "/radar"]) {
      await page.goto(path);
      await expect(
        page.getByRole("button", { name: /notificações/i }),
      ).toHaveCount(0);
    }
  });

  test("GET /api/notifications deslogado → 401 JSON", async ({ request }) => {
    const res = await request.get("/api/notifications");
    expect(res.status()).toBe(401);
    expect(res.headers()["content-type"]).toContain("application/json");
  });

  test("POST /api/notifications deslogado → 401 JSON", async ({ request }) => {
    const res = await request.post("/api/notifications", {
      data: { action: "readAll" },
    });
    expect(res.status()).toBe(401);
    expect(res.headers()["content-type"]).toContain("application/json");
  });
});
