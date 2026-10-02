import { expect, test } from "@playwright/test";

// BDD do admin operacional — spec 004. Sem login tudo é 401/redirect;
// fluxos autenticados (editar edição, exportar CSV) são testados pelo
// usuário no tunnel público (Clerk captcha bloqueia automação — ver AGENTS.md).

test.describe("admin operacional — APIs trancadas sem login", () => {
  test("subscribers, registrations e PATCH respondem 401", async ({
    request,
  }) => {
    for (const path of [
      "/api/admin/subscribers",
      "/api/admin/subscribers?format=csv",
      "/api/admin/hackathons/hack-inova-alphaville-2026/registrations",
    ]) {
      const res = await request.get(path);
      expect(res.status()).toBe(401);
      expect(res.headers()["content-type"]).toContain("application/json");
    }
    const patch = await request.fetch(
      "/api/admin/hackathons/hack-inova-alphaville-2026",
      { method: "PATCH", data: { name: "invasão" } },
    );
    expect(patch.status()).toBe(401);
  });

  test("arquivo (spec 015) — POST teams/assets respondem 401", async ({
    request,
  }) => {
    const hack = "hack-inova-unifacens-2026";
    const team = await request.post(`/api/admin/hackathons/${hack}/teams`, {
      data: { name: "invasão", placement: 1 },
    });
    expect(team.status()).toBe(401);
    expect(team.headers()["content-type"]).toContain("application/json");
    const asset = await request.post(`/api/admin/hackathons/${hack}/assets`, {
      data: { type: "foto", url: "https://x.dev/a.png" },
    });
    expect(asset.status()).toBe(401);
    expect(asset.headers()["content-type"]).toContain("application/json");
  });

  test("/admin exige login — redirect pro sign-in", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/sign-in|clerk/i, { timeout: 15000 });
  });
});
