import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { test } from "./auth";
import { openE2eDb } from "./db";

// spec 033 US1 — formulário de inscrição por edição + aceite LGPD + vagas.
// Login real é bloqueado pelo captcha do Clerk, então o e2e cobre o lado
// público: CTA pra anon, formulário renderizando as perguntas seedadas,
// caixa de aceite na edição sem perguntas e APIs anon → 401 JSON.
const WITH_FORM = "e2e-form-jam";
const NO_FORM = "e2e-form-sem";

async function seed(request: APIRequestContext) {
  await request.get("/api/health"); // força init/migrações no server do e2e
  const db = openE2eDb();
  const future = new Date(Date.now() + 30 * 86_400_000).toISOString();
  for (const [id, name, capacity] of [
    [WITH_FORM, "E2E Form Jam", 40],
    [NO_FORM, "E2E Sem Perguntas", null],
  ] as const) {
    await db
      .prepare(
        `INSERT INTO hackathons
           (id, name, organizer, startsAt, format, registrationUrl, tags, active, source, capacity)
         VALUES (?, ?, 'Hack Inova E2E', ?, 'presencial', 'https://e2e.dev/form', '[]', 1, 'e2e', ?)
         ON CONFLICT(id) DO UPDATE SET startsAt = excluded.startsAt, active = 1, capacity = excluded.capacity`,
      )
      .run(id, name, future, capacity);
  }
  await db.prepare("DELETE FROM edition_questions WHERE hackathonId = ?").run(WITH_FORM);
  const questions = [
    ["short_text", "Qual seu curso?", "[]", 1],
    ["single", "Tamanho da camiseta", '["P","M","G","GG"]', 0],
    ["multi", "Restrição alimentar", '["vegetariano","vegano","sem glúten"]', 0],
    ["yes_no", "Já tem time?", "[]", 0],
  ] as const;
  for (const [i, [kind, label, options, required]] of questions.entries()) {
    const row = await db
      .prepare(
        `INSERT INTO edition_questions (hackathonId, kind, label, options, required, position)
         VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
      )
      .get<{ id: number }>(WITH_FORM, kind, label, options, required, i + 1);
    await db
      .prepare(
        `INSERT INTO edition_question_versions (questionId, version, kind, label, options, required)
         VALUES (?, 1, ?, ?, ?, ?)`,
      )
      .run(row!.id, kind, label, options, required);
  }
}

async function noHorizontalScroll(page: Page) {
  const { sw, cw } = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    cw: document.documentElement.clientWidth,
  }));
  expect(sw).toBeLessThanOrEqual(cw);
}

test.describe("formulário de inscrição da edição (spec 033 US1)", () => {
  test("membro sem inscrição vê o CTA que leva pro formulário na página da edição", async ({ memberPage: page, request }) => {
    await seed(request);
    await page.goto(`/h/${WITH_FORM}`, { waitUntil: "domcontentloaded" });
    const cta = page.getByRole("link", { name: /fazer inscrição/i });
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute("href", `/h/${WITH_FORM}/inscricao`);
    await expect(page.getByTestId("edition-capacity")).toContainText("40 de 40");
  });

  test("formulário renderiza as perguntas seedadas, o aceite e o resumo do perfil", async ({ memberPage: page, request }) => {
    await seed(request);
    await page.goto(`/h/${WITH_FORM}/inscricao`, { waitUntil: "domcontentloaded" });
    const form = page.getByTestId("registration-form");
    await expect(form).toBeVisible();
    await expect(form.getByText("Qual seu curso?")).toBeVisible();
    await expect(form.getByRole("radio", { name: "GG" })).toBeVisible();
    await expect(form.getByRole("checkbox", { name: "vegano" })).toBeVisible();
    await expect(form.getByRole("radiogroup", { name: "Já tem time?" })).toBeVisible();
    // logado: o resumo mostra o que vem do perfil (spec 039: a página é de quem tem conta)
    await expect(page.getByRole("link", { name: "ajustar no perfil" })).toHaveAttribute("href", "/perfil");
    // aceite LGPD: nunca pré-marcado, cita a organização e os termos
    const consent = form.getByRole("checkbox", { name: /Autorizo Hack Inova E2E a tratar/ });
    await expect(consent).not.toBeChecked();
    await expect(form.getByRole("link", { name: "termos" })).toHaveAttribute("href", "/legal/termos");
    await expect(form.getByRole("button", { name: /concluir inscrição/i })).toBeVisible();
  });

  test("enviar sem marcar o aceite avisa e não sai da página", async ({ memberPage: page, request }) => {
    await seed(request);
    await page.goto(`/h/${WITH_FORM}/inscricao`, { waitUntil: "domcontentloaded" });
    // frente L: a data de nascimento vem antes do aceite
    // repete até hidratar: antes disso o onChange do React não pega o fill
    await expect(async () => {
      await page.getByLabel(/data de nascimento/i).fill("2000-01-01");
      await page.getByRole("button", { name: /concluir inscrição/i }).click();
      await expect(page.getByTestId("registration-form").getByRole("alert")).toContainText(/aceite/, { timeout: 1000 });
    }).toPass();
    await expect(page).toHaveURL(new RegExp(`/h/${WITH_FORM}/inscricao`));
  });

  test("edição sem perguntas também vai pro formulário (nascimento, conduta e imagem não cabem em 1 clique)", async ({
    memberPage: page,
    request,
  }) => {
    await seed(request);
    await page.goto(`/h/${NO_FORM}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("link", { name: /fazer inscrição/i })).toHaveAttribute("href", `/h/${NO_FORM}/inscricao`);
    await page.goto(`/h/${NO_FORM}/inscricao`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("checkbox", { name: /Autorizo Hack Inova E2E a tratar/ })).not.toBeChecked();
  });

  test("APIs anon → 401 JSON (register, perguntas, capacidade, CSV)", async ({ request }) => {
    await seed(request);
    const post = await request.post(`/api/hackathons/${WITH_FORM}/register`, {
      data: { consent: true, answers: {} },
    });
    expect(post.status()).toBe(401);
    expect(post.headers()["content-type"]).toContain("application/json");
    for (const res of [
      await request.get(`/api/admin/hackathons/${WITH_FORM}/questions`),
      await request.post(`/api/admin/hackathons/${WITH_FORM}/questions`, {
        data: { kind: "short_text", label: "invasão" },
      }),
      await request.patch(`/api/admin/hackathons/${WITH_FORM}/questions/1`, { data: { archived: true } }),
      await request.put(`/api/admin/hackathons/${WITH_FORM}/capacity`, { data: { capacity: 1 } }),
      await request.get(`/api/admin/hackathons/${WITH_FORM}/registrations?format=csv`),
    ]) {
      expect(res.status()).toBe(401);
      expect(res.headers()["content-type"]).toContain("application/json");
    }
  });

  test("390px sem scroll horizontal no formulário e na edição", async ({ memberPage: page, request }) => {
    await seed(request);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/h/${WITH_FORM}/inscricao`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    await noHorizontalScroll(page);
    await page.screenshot({ path: "test-results/feat-b/inscricao-390.png", fullPage: true });
    await page.goto(`/h/${NO_FORM}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1000);
    await noHorizontalScroll(page);
  });
});
