import { expect, test } from "@playwright/test";

// BDD do blog + infra de SEO — spec 009. Tudo público, sem login.

test.describe("blog — listagem e leitura", () => {
  test("/blog lista os posts com título, data e tags", async ({ page }) => {
    await page.goto("/blog");
    await expect(
      page.getByRole("heading", { name: /bastidores e guias/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /hack inova unifacens/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /deploy da demo/i }),
    ).toBeVisible();
    await expect(page.getByText(/#recap/i).first()).toBeVisible();
  });

  test("/blog/[slug] renderiza o artigo com tipografia e volta", async ({
    page,
  }) => {
    await page.goto("/blog/o-que-rolou-no-hack-inova-unifacens");
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: /o que rolou no hack inova unifacens/i,
      }),
    ).toBeVisible();
    // conteúdo real do post
    await expect(page.getByText(/280/i).first()).toBeVisible();
    await expect(
      page.getByRole("link", { name: /voltar pro blog/i }),
    ).toBeVisible();
  });

  test("slug inexistente dá 404", async ({ page }) => {
    const res = await page.goto("/blog/post-que-nao-existe");
    expect(res?.status()).toBe(404);
  });

  test("header tem link pro blog", async ({ page }) => {
    await page.goto("/");
    await expect(
      page
        .locator("header")
        .getByRole("link", { name: "blog", exact: true }),
    ).toBeVisible();
  });
});

test.describe("seo — metadata e dados estruturados", () => {
  test("post tem canonical, og:type article e JSON-LD Article", async ({
    page,
  }) => {
    await page.goto("/blog/o-que-rolou-no-hack-inova-unifacens");
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      /\/blog\/o-que-rolou-no-hack-inova-unifacens/,
    );
    await expect(page.locator('meta[property="og:type"]')).toHaveAttribute(
      "content",
      "article",
    );
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
      "content",
      /unifacens/i,
    );
    const ld = page.locator('script[type="application/ld+json"]');
    await expect(ld.first()).toBeAttached();
    const json = JSON.parse((await ld.first().textContent()) ?? "{}");
    expect(json["@type"]).toBe("Article");
    expect(json.headline).toMatch(/unifacens/i);
  });

  test("/h/[id] tem og:title da edição e JSON-LD Event", async ({ page }) => {
    await page.goto("/h/hack-inova-unifacens-2026");
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
      "content",
      /payment shift/i,
    );
    const ld = page.locator('script[type="application/ld+json"]');
    await expect(ld.first()).toBeAttached();
    const json = JSON.parse((await ld.first().textContent()) ?? "{}");
    expect(json["@type"]).toBe("Event");
    expect(json.name).toMatch(/payment shift/i);
    expect(json.location?.name).toMatch(/unifacens/i);
  });

  test("/sitemap.xml retorna 200 e lista /blog e /h/*", async ({
    request,
  }) => {
    const res = await request.get("/sitemap.xml");
    expect(res.status()).toBe(200);
    const xml = await res.text();
    expect(xml).toContain("/blog");
    expect(xml).toContain("/blog/o-que-rolou-no-hack-inova-unifacens");
    expect(xml).toContain("/h/hack-inova-unifacens-2026");
  });

  test("/robots.txt permite tudo e aponta o sitemap", async ({ request }) => {
    const res = await request.get("/robots.txt");
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain("Allow: /");
    expect(body.toLowerCase()).toContain("sitemap:");
  });

  test("OG image padrão responde imagem", async ({ page, request }) => {
    await page.goto("/blog");
    const ogImage = await page
      .locator('meta[property="og:image"]')
      .getAttribute("content");
    expect(ogImage).toBeTruthy();
    // og:image sai absoluto com a origem canônica (SITE_URL) — certo pra
    // SEO; o teste valida a rota servindo a imagem, então rebaixa o host
    const ogPath = new URL(ogImage!).pathname + new URL(ogImage!).search;
    const res = await request.get(ogPath);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/");
  });
});
