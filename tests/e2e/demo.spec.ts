import { expect, test } from "@playwright/test";

// proxy de demos — sem container rodando o tombstone deve aparecer (410),
// e a rota tem que existir (não 404 de rota ausente)
test.describe("deploy tool — proxy público", () => {
  test("demo inexistente/parada mostra tombstone honesto", async ({
    request,
  }) => {
    const res = await request.get("/demo/nao-existe-123/");
    expect(res.status()).toBe(410);
    const html = await res.text();
    expect(html).toContain("demo");
  });

  test("sub-path também passa pelo proxy/tombstone", async ({ request }) => {
    const res = await request.get("/demo/nao-existe-123/assets/app.js");
    expect(res.status()).toBe(410);
  });
});
