import { expect, type Page } from "@playwright/test";
import { E2E_MEMBER_EMAIL, memberRequest, test } from "./auth";
import { openE2eDb } from "./db";

// Vitrine do projeto (spec 046, migration 036). O time conta a história,
// marca "Feito com" em chips e monta a galeria no editor da entrega; envia;
// depois da trava a vitrine segue editável e a página avisa "atualizado
// depois da entrega". Quem não tem conta vê a página completa sem feedback
// do júri, com integrante fora do canNetwork como "integrante", e
// /projetos?tech= acha o projeto. Tudo a 390px sem scroll de lado.

const ED = "e2e-vitrine";
const H = 3_600_000;
const SHOTS = process.env.E2E_SHOTS_DIR;
const ids: Record<string, number> = {};
const dbTime = (t: number) => new Date(t).toISOString().slice(0, 19).replace("T", " ");

async function noHorizontalScroll(page: Page) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(sw, "scroll horizontal").toBeLessThanOrEqual(iw);
}

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

async function setDeadline(t: number) {
  await openE2eDb()
    .prepare("UPDATE hackathons SET submissionDeadline = ?, submissionGraceMinutes = 0 WHERE id = ?")
    .run(dbTime(t), ED);
}

async function project() {
  return openE2eDb()
    .prepare(`SELECT inspiration, "howBuilt", learned, "coverUrl", technologies FROM team_projects WHERE teamId = ?`)
    .get<{ inspiration: string | null; howBuilt: string | null; learned: string | null; coverUrl: string | null; technologies: string }>(
      ids.team,
    );
}

test.describe.configure({ mode: "serial" });

test.describe("vitrine do projeto", () => {
  test.beforeAll(async ({ request }) => {
    await request.get("/api/health");
    const db = openE2eDb();
    await db
      .prepare(
        `INSERT INTO hackathons (id, name, organizer, startsAt, endsAt, format, registrationUrl, tags, active, source,
                                 submissionDeadline, submissionGraceMinutes, entriesShowContent)
         VALUES (?, 'E2E Vitrine', 'Hack Inova E2E', ?, ?, 'presencial', '/h/e2e-vitrine', '[]', 1, 'painel', ?, 0, 1)
         ON CONFLICT (id) DO UPDATE SET startsAt = excluded.startsAt, endsAt = excluded.endsAt,
           submissionDeadline = excluded.submissionDeadline, active = 1, entriesShowContent = 1`,
      )
      .run(ED, new Date(Date.now() - 24 * H).toISOString(), new Date(Date.now() + 24 * H).toISOString(), dbTime(Date.now() + 5 * H));
    for (const sql of [
      "DELETE FROM announcements WHERE hackathonId = ?",
      "DELETE FROM submission_events WHERE hackathonId = ?",
      "DELETE FROM project_submissions WHERE teamId IN (SELECT id FROM teams WHERE hackathonId = ?)",
      "DELETE FROM project_media WHERE teamId IN (SELECT id FROM teams WHERE hackathonId = ?)",
      "DELETE FROM project_tech WHERE teamId IN (SELECT id FROM teams WHERE hackathonId = ?)",
      "DELETE FROM team_projects WHERE teamId IN (SELECT id FROM teams WHERE hackathonId = ?)",
      "DELETE FROM team_members WHERE teamId IN (SELECT id FROM teams WHERE hackathonId = ?)",
      "DELETE FROM teams WHERE hackathonId = ?",
      "DELETE FROM registrations WHERE hackathonId = ?",
    ]) {
      await db.prepare(sql).run(ED);
    }
    const me = await db
      .prepare("SELECT id, username FROM members WHERE email = ?")
      .get<{ id: number; username: string }>(E2E_MEMBER_EMAIL);
    if (!me) throw new Error("membro de teste não existe no banco do e2e");
    // par visível com nome e papel; o segundo é conta excluída (canNetwork falso)
    await db
      .prepare(`INSERT INTO members (clerkId, username, email, name) VALUES ('clerk_vitrine_par', 'vitrine_par', 'vitrine_par@e2e.dev', 'Bia Par')
                ON CONFLICT DO NOTHING`)
      .run();
    await db
      .prepare(`INSERT INTO members (clerkId, username, email, name) VALUES ('deleted:vitrine', 'vitrine_fora', 'vitrine_fora@e2e.dev', 'Nome Que Não Aparece')
                ON CONFLICT DO NOTHING`)
      .run();
    const others = await db
      .prepare("SELECT id FROM members WHERE username IN ('vitrine_par', 'vitrine_fora')")
      .all<{ id: number }>();
    for (const m of [{ id: me.id }, ...others]) {
      await db.prepare("INSERT INTO registrations (memberId, hackathonId, status) VALUES (?, ?, 'approved')").run(m.id, ED);
    }
    const t = await db
      .prepare("INSERT INTO teams (hackathonId, name, placement) VALUES (?, 'Time Vitrine E2E', 0) RETURNING id")
      .get<{ id: number }>(ED);
    ids.team = t!.id;
    for (const u of [me.username, "vitrine_par", "vitrine_fora"]) {
      await db.prepare("INSERT INTO team_members (teamId, username) VALUES (?, ?)").run(ids.team, u);
    }
    await db.prepare("UPDATE team_members SET role = 'back-end e banco' WHERE teamId = ? AND username = 'vitrine_par'").run(ids.team);
    await db.prepare("UPDATE team_members SET role = 'segredo de quem saiu' WHERE teamId = ? AND username = 'vitrine_fora'").run(ids.team);
    await db
      .prepare(
        `INSERT INTO team_projects (teamId, title, tagline, description, priorWork, technologies, repoUrl, afterNotes)
         VALUES (?, 'Feira Viva E2E', 'a feira do bairro no celular', 'Mostra as barracas abertas agora.', 'nada antes',
                 '["Python"]', 'https://gitlab.com/e2e/feira-viva', 'virou piloto com a subprefeitura')`,
      )
      .run(ids.team);
  });

  test("time conta a história, marca as tecnologias e monta a galeria", async ({ memberPage: page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/h/${ED}/entrega`);
    await expect(page.getByLabel(/o que faz \*/)).toHaveValue("Mostra as barracas abertas agora.");

    // Feito com: chip existente, digita com Enter e escolhe sugestão
    const chips = page.getByTestId("tech-chips");
    await expect(chips.getByText("Python")).toBeVisible();
    const add = page.getByLabel("adicionar tecnologia");
    await add.fill("next.js");
    await add.press("Enter");
    await add.fill("postg");
    await chips.getByRole("button", { name: "PostgreSQL" }).click();
    await expect(chips.getByText("2/12")).toHaveCount(0);
    await expect(chips.getByText("3/12")).toBeVisible();
    await expect(page.getByText(/último salvamento/)).toBeVisible({ timeout: 15_000 });

    const vitrine = page.getByTestId("showcase-editor");
    await vitrine.getByLabel(/seu papel no time/).fill("front e pitch");
    await vitrine.getByLabel(/^Inspiração/).fill("a feira some do mapa toda semana");
    await vitrine.getByLabel(/^Como foi feito/).fill("três noites de Next.js e Postgres");
    await vitrine.getByLabel(/^O que aprendemos/).fill("falar com feirante antes de codar");
    await vitrine.getByLabel(/^capa/).fill("https://img.e2e.invalid/capa.png");
    await vitrine.getByRole("button", { name: "+ imagem" }).click();
    await vitrine.getByLabel("imagem 1", { exact: true }).fill("https://img.e2e.invalid/tela-1.png");
    await vitrine.getByLabel("legenda da imagem 1").fill("tela inicial");
    await vitrine.getByRole("button", { name: "+ imagem" }).click();
    await vitrine.getByLabel("imagem 2", { exact: true }).fill("https://img.e2e.invalid/tela-2.png");
    await vitrine.getByRole("button", { name: "subir imagem 2" }).click();
    await expect(vitrine.getByLabel("imagem 1", { exact: true })).toHaveValue("https://img.e2e.invalid/tela-2.png");

    await expect
      .poll(async () => (await project())?.learned, { timeout: 15_000 })
      .toBe("falar com feirante antes de codar");
    await expect(vitrine.getByTestId("showcase-save")).toHaveText("vitrine salva", { timeout: 15_000 });
    const p = await project();
    expect(JSON.parse(p!.technologies)).toEqual(["Python", "next.js", "PostgreSQL"]);
    expect(p!.coverUrl).toBe("https://img.e2e.invalid/capa.png");
    const media = await openE2eDb()
      .prepare("SELECT url FROM project_media WHERE teamId = ? ORDER BY position")
      .all<{ url: string }>(ids.team);
    expect(media.map((m) => m.url)).toEqual(["https://img.e2e.invalid/tela-2.png", "https://img.e2e.invalid/tela-1.png"]);
    await noHorizontalScroll(page);
    await shot(page, "vitrine-editor-390");

    page.once("dialog", (d) => void d.accept());
    await page.getByRole("button", { name: /enviar versão 1/ }).click();
    await expect(page.getByText("versão 1 enviada — o time recebeu a confirmação")).toBeVisible({ timeout: 20_000 });
  });

  test("galeria com http e capa com http dão 400", async ({ memberPage: page }) => {
    const api = await memberRequest(page);
    const gal = await api.patch(`/api/hackathons/${ED}/entry`, { data: { media: [{ url: "http://img.e2e.invalid/x.png" }] } });
    expect(gal.status()).toBe(400);
    const cover = await api.patch(`/api/hackathons/${ED}/entry`, { data: { coverUrl: "http://img.e2e.invalid/x.png" } });
    expect(cover.status()).toBe(400);
  });

  test("depois da trava a vitrine segue editável e a página avisa", async ({ memberPage: page }) => {
    await setDeadline(Date.now() - 60_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/h/${ED}/entrega`);
    await expect(page.getByTestId("entry-status")).toHaveText(/entregue/i);
    await expect(page.getByLabel("adicionar tecnologia")).toBeDisabled();
    const vitrine = page.getByTestId("showcase-editor");
    await vitrine.getByLabel(/^Desafios/).fill("GPS dentro do galpão da feira");
    await expect
      .poll(async () => (await openE2eDb().prepare("SELECT challenges FROM team_projects WHERE teamId = ?").get<{ challenges: string }>(ids.team))?.challenges, {
        timeout: 15_000,
      })
      .toBe("GPS dentro do galpão da feira");

    await page.goto(`/p/${ids.team}`);
    const aviso = page.getByTestId("updated-after");
    await expect(aviso).toContainText("atualizado depois da entrega");
    await expect(page.getByTestId("story-desafios")).toContainText("GPS dentro do galpão da feira");
    await aviso.getByRole("link", { name: /ver como foi entregue/ }).click();
    await expect(page).toHaveURL(/versao=entregue/);
    await expect(page.getByTestId("as-delivered")).toContainText("como foi entregue");
    await expect(page.getByTestId("story-desafios")).toHaveCount(0);
    await expect(page.getByTestId("story-inspiracao")).toContainText("a feira some do mapa toda semana");
    await noHorizontalScroll(page);
  });

  test("logado: seções na ordem, Feito com navegável e Quem fez com papel", async ({ memberPage: page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/p/${ids.team}`);
    const body = page.getByTestId("project-page");
    const text = await body.innerText();
    const order = ["O que faz", "Inspiração", "Como foi feito", "Desafios", "O que aprendemos", "Depois do hackathon"].map((s) =>
      text.indexOf(s),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    await expect(page.getByTestId("project-cover")).toHaveAttribute("src", "https://img.e2e.invalid/capa.png");
    await expect(page.getByTestId("project-gallery").locator("img")).toHaveCount(2);
    await expect(page.getByTestId("project-gallery").locator("img").first()).toHaveAttribute("loading", "lazy");
    const credits = page.getByTestId("team-credits");
    await expect(credits.getByRole("link", { name: "Bia Par" })).toHaveAttribute("href", "/u/vitrine_par");
    await expect(credits).toContainText("back-end e banco");
    await expect(credits).toContainText("front e pitch");
    await expect(credits).toContainText("integrante");
    await expect(credits).not.toContainText("Nome Que Não Aparece");
    await expect(credits).not.toContainText("segredo de quem saiu");
    await expect(page.getByTestId("built-with").getByRole("link", { name: "next.js" })).toHaveAttribute(
      "href",
      "/projetos?tech=nextjs",
    );
    await noHorizontalScroll(page);
    await shot(page, "vitrine-logado-390");
  });

  test("sem conta: página completa, sem feedback do júri nem botão de voto", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/p/${ids.team}`);
    await expect(page.getByTestId("public-card")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Feira Viva E2E", exact: true })).toBeVisible();
    await expect(page.getByTestId("story-inspiracao")).toContainText("a feira some do mapa toda semana");
    await expect(page.getByTestId("story-depois")).toContainText("virou piloto com a subprefeitura");
    await expect(page.getByRole("link", { name: /repositório/ })).toHaveAttribute("href", "https://gitlab.com/e2e/feira-viva");
    await expect(page.getByTestId("feedback-link")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /escolha do povo/i })).toHaveCount(0);
    await expect(page.getByTestId("anon-vote").getByRole("link")).toHaveAttribute(
      "href",
      `/sign-up?redirect_url=${encodeURIComponent(`/p/${ids.team}`)}`,
    );
    const credits = page.getByTestId("team-credits");
    await expect(credits).toContainText("integrante");
    await expect(credits).not.toContainText("Nome Que Não Aparece");
    await noHorizontalScroll(page);
    await shot(page, "vitrine-anon-390");

    const og = await page.request.get(`/p/${ids.team}/opengraph-image`);
    expect(og.status()).toBe(200);
    expect(og.headers()["content-type"]).toContain("image/png");
    expect(og.headers()["cache-control"]).toContain("max-age=3600");
  });

  test("antes do prazo, sem conta, continua o cartão público", async ({ page }) => {
    await setDeadline(Date.now() + 5 * H);
    await page.goto(`/p/${ids.team}`);
    await expect(page.getByTestId("public-card")).toBeVisible();
    await expect(page.getByTestId("public-card")).toContainText("O projeto entregue aparece aqui quando a edição publica as entregas.");
    await expect(page.getByText("a feira some do mapa toda semana")).toHaveCount(0);
    await setDeadline(Date.now() - 60_000);
  });

  test("/projetos?tech=nextjs acha o projeto; chips de tecnologia filtram", async ({ memberPage: page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/projetos?tech=nextjs");
    const card = page.locator("li", { hasText: "Feira Viva E2E" });
    await expect(card).toHaveCount(1);
    await expect(card.getByRole("link", { name: "PostgreSQL" })).toHaveAttribute("href", /tech=postgresql/);
    const filter = page.getByTestId("tech-filter");
    await expect(filter.getByRole("link", { name: /Next\.js/ })).toHaveAttribute("aria-current", "page");
    await noHorizontalScroll(page);
    await shot(page, "vitrine-projetos-tech-390");

    await page.goto("/projetos?tech=tecnologia-que-ninguem-usa");
    await expect(page.locator("li", { hasText: "Feira Viva E2E" })).toHaveCount(0);
    await expect(page.getByText("nenhum projeto feito com tecnologia-que-ninguem-usa ainda")).toBeVisible();
  });

  test("mudar só o papel não apaga o que o colega salvou depois que a página abriu", async ({ memberPage: page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/h/${ED}/entrega`);
    const vitrine = page.getByTestId("showcase-editor");
    await expect(vitrine.getByLabel(/^Como foi feito/)).toHaveValue("três noites de Next.js e Postgres");
    // o colega salva a história e a galeria com a página já aberta
    const db = openE2eDb();
    await db.prepare(`UPDATE team_projects SET "howBuilt" = 'reescrito pela Bia' WHERE teamId = ?`).run(ids.team);
    await db
      .prepare("INSERT INTO project_media (teamId, url, caption, position) VALUES (?, 'https://img.e2e.invalid/tela-3.png', 'da Bia', 2)")
      .run(ids.team);

    await vitrine.getByLabel(/seu papel no time/).fill("front, pitch e testes");
    await expect
      .poll(
        async () =>
          (
            await db
              .prepare("SELECT tm.role FROM team_members tm JOIN members m ON m.username = tm.username WHERE tm.teamId = ? AND m.email = ?")
              .get<{ role: string | null }>(ids.team, E2E_MEMBER_EMAIL)
          )?.role,
        { timeout: 15_000 },
      )
      .toBe("front, pitch e testes");
    await expect(vitrine.getByTestId("showcase-save")).toHaveText("vitrine salva", { timeout: 15_000 });
    expect((await project())?.howBuilt).toBe("reescrito pela Bia");
    const media = await db.prepare("SELECT url FROM project_media WHERE teamId = ? ORDER BY position").all<{ url: string }>(ids.team);
    expect(media).toHaveLength(3);
    // e o editor passa a mostrar o que o colega salvou
    await expect(vitrine.getByLabel(/^Como foi feito/)).toHaveValue("reescrito pela Bia");
    await expect(vitrine.getByLabel("imagem 3", { exact: true })).toHaveValue("https://img.e2e.invalid/tela-3.png");
  });
});
