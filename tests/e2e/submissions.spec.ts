import { expect, test } from "@playwright/test";
import { openE2eDb } from "./db";

// BDD da indicação de hackathon — spec 026. O POST /api/submissions é
// público (indicar não exige login), então o fluxo inteiro de entrada é
// testável sem Clerk. A curadoria é admin-only: anon recebe 401 JSON.
// spec 031: /api/submissions limita 5/h por IP — xff único por request pra
// não esgotar o bucket 'anon' (dev server compartilhado entre specs/runs).

const rand = () => Math.floor(Math.random() * 254) + 1;
const xff = () => ({
  "x-forwarded-for": `10.${rand()}.${rand()}.${rand()}`,
});

const subsCount = (url: string) => {
  const db = openE2eDb();
  db.pragma("busy_timeout = 5000");
  const n = (
    db
      .prepare("SELECT COUNT(*) n FROM event_submissions WHERE url = ?")
      .get(url) as { n: number } | undefined
  )?.n;
  db.close();
  return n ?? 0;
};

test.describe("/radar — bloco indica um hackathon", () => {
  test("rodapé do radar tem o details com o formulário de indicação", async ({
    page,
  }) => {
    const res = await page.goto("/radar");
    expect(res?.status()).toBe(200);
    const bloco = page.locator("details", { hasText: /indica um hackathon/i });
    await expect(bloco).toBeVisible();
    // abre e mostra o form com os campos da spec
    await bloco.locator("summary").click();
    await expect(bloco.getByLabel(/nome/i)).toBeVisible();
    await expect(bloco.getByLabel(/link|url/i)).toBeVisible();
    await expect(
      bloco.getByRole("button", { name: /indicar|enviar/i }),
    ).toBeVisible();
  });
});

test.describe("POST /api/submissions — público", () => {
  test("indicação válida anon → 201; honeypot → 201 sem gravar", async ({
    request,
  }) => {
    const url = `https://e2e-${Date.now()}.dev/hack`;
    const ok = await request.post("/api/submissions", {
      headers: xff(),
      data: { name: "Hack E2E", url },
    });
    expect(ok.status()).toBe(201);
    expect(subsCount(url)).toBe(1);

    const botUrl = `https://e2e-bot-${Date.now()}.dev`;
    const bot = await request.post("/api/submissions", {
      headers: xff(),
      data: { name: "Bot Hack", url: botUrl, company: "Spam Co" },
    });
    expect(bot.status()).toBe(201);
    expect(subsCount(botUrl)).toBe(0);
  });

  test("inválido → 400; mesma url → 200 sem duplicar", async ({ request }) => {
    const bad = await request.post("/api/submissions", {
      headers: xff(),
      data: { name: "X", url: "javascript:alert(1)" },
    });
    expect(bad.status()).toBe(400);

    const url = `https://e2e-dup-${Date.now()}.dev`;
    const body = { name: "Dup", url };
    expect(
      (await request.post("/api/submissions", { headers: xff(), data: body }))
        .status(),
    ).toBe(201);
    expect(
      (await request.post("/api/submissions", { headers: xff(), data: body }))
        .status(),
    ).toBe(200);
    expect(subsCount(url)).toBe(1);
  });
});

test.describe("curadoria — rotas admin respondem 401 anon", () => {
  test("GET /api/submissions e POST /api/admin/submissions/[id] → 401 JSON", async ({
    request,
  }) => {
    const list = await request.get("/api/submissions");
    expect(list.status()).toBe(401);
    expect(list.headers()["content-type"]).toContain("application/json");

    const review = await request.post("/api/admin/submissions/1", {
      data: { action: "approve" },
    });
    expect(review.status()).toBe(401);
    expect(review.headers()["content-type"]).toContain("application/json");
  });
});
