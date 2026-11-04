import { expect, type Page } from "@playwright/test";
import { test } from "./auth";
import { openE2eDb } from "./db";

// BDD da entrega de projeto — spec 034 §5. Enviar e operar o painel exigem
// login (Clerk captcha bloqueia automação), então o e2e cobre o lado
// público com estados seedados direto no banco: matriz de visibilidade
// (antes do prazo só contagem; depois, All Entries + mostruário; depois da
// publicação, resultados por categoria e vídeo do palco), a ficha /p na
// ordem nova, o bloco de prazos e as portas trancadas.

const ANTES = "e2e-034-antes";
const DEPOIS = "e2e-034-depois";
const SHOTS = process.env.E2E_SHOTS_DIR;
const ids: Record<string, number> = {};

const iso = (t: number) => new Date(t).toISOString().slice(0, 19).replace("T", " ");
const H = 3_600_000;

async function edition(id: string, name: string, deadline: number) {
  const db = openE2eDb();
  await db
    .prepare(
      `INSERT INTO hackathons (id, name, organizer, startsAt, endsAt, format, registrationUrl, tags, active, source,
                               submissionDeadline, teamFormationDeadline, juryDeadline)
       VALUES (?, ?, 'Hack Inova', ?, ?, 'presencial', 'https://e2e.dev/034', '[]', 1, 'painel', ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET submissionDeadline = excluded.submissionDeadline`,
    )
    .run(id, name, iso(Date.now() - 24 * H), iso(Date.now() + 24 * H), iso(deadline), iso(deadline - 6 * H), iso(deadline + 6 * H));
}

async function team(hackathonId: string, name: string, project: Record<string, unknown> | null, submit: boolean) {
  const db = openE2eDb();
  const t = await db
    .prepare("INSERT INTO teams (hackathonId, name, placement) VALUES (?, ?, 0) RETURNING id")
    .get<{ id: number }>(hackathonId, name);
  const user = `e2e034_${t!.id}`;
  await db.prepare("INSERT OR IGNORE INTO members (clerkId, username, email) VALUES (?, ?, ?)").run(user, user, `${user}@t.dev`);
  await db.prepare("INSERT INTO team_members (teamId, username) VALUES (?, ?)").run(t!.id, user);
  if (project) {
    await db
      .prepare(
        `INSERT INTO team_projects (teamId, title, tagline, description, priorWork, technologies, videoUrl, repoUrl, stageVideoUrl, afterNotes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        t!.id,
        project.title,
        project.tagline ?? null,
        project.description ?? null,
        project.priorWork ?? null,
        JSON.stringify(project.technologies ?? []),
        project.videoUrl ?? null,
        project.repoUrl ?? null,
        project.stageVideoUrl ?? null,
        project.afterNotes ?? null,
      );
    if (submit) {
      const snap = { ...project, links: [], socialPosts: [], challengeIds: [], members: [user] };
      await db
        .prepare("INSERT INTO project_submissions (teamId, version, snapshot, submittedAt) VALUES (?, 1, ?, ?)")
        .run(t!.id, JSON.stringify(snap), iso(Date.now() - 30 * H));
    }
  }
  return t!.id;
}

test.beforeAll(async ({ request }) => {
  await request.get("/api/health"); // server inicializa o banco (migrations + seed)
  const db = openE2eDb();
  for (const id of [ANTES, DEPOIS]) {
    await db.prepare("DELETE FROM prize_categories WHERE hackathonId = ?").run(id);
    await db.prepare("DELETE FROM jury_results WHERE hackathonId = ?").run(id);
    await db.prepare("DELETE FROM project_submissions WHERE teamId IN (SELECT id FROM teams WHERE hackathonId = ?)").run(id);
    await db.prepare("DELETE FROM team_projects WHERE teamId IN (SELECT id FROM teams WHERE hackathonId = ?)").run(id);
    await db.prepare("DELETE FROM team_members WHERE teamId IN (SELECT id FROM teams WHERE hackathonId = ?)").run(id);
    await db.prepare("DELETE FROM teams WHERE hackathonId = ?").run(id);
  }
  await edition(ANTES, "E2E 034 Antes do Prazo", Date.now() + 5 * H);
  await edition(DEPOIS, "E2E 034 Depois do Prazo", Date.now() - 2 * H);

  ids.antesEnviado = await team(ANTES, "Antes Enviado", { title: "Projeto Secreto", tagline: "não pode vazar", technologies: ["Go"] }, true);
  ids.antesRascunho = await team(ANTES, "Antes Rascunho", { title: "Rascunho Secreto" }, false);

  const rich = {
    title: "Fila Zero",
    tagline: "fila do posto de saúde em tempo real",
    description: "Problema: fila. Solução: app.",
    priorWork: "protótipo no Figma antes do evento",
    technologies: ["Next.js", "Postgres"],
    videoUrl: "https://youtu.be/e2e034",
    repoUrl: "https://github.com/e2e/fila-zero",
    stageVideoUrl: "https://youtu.be/e2e034-palco",
    afterNotes: "piloto com a prefeitura em novembro",
  };
  ids.campeao = await team(DEPOIS, "Time Campeão", rich, true);
  ids.semVideo = await team(DEPOIS, "Time Sem Vídeo", { title: "Planilha Viva", tagline: "sem vídeo", technologies: ["Python"] }, true);
  ids.naoEntregou = await team(DEPOIS, "Time Atrasado", { title: "Nunca Enviado" }, false);

  const cat = await db
    .prepare("INSERT INTO prize_categories (hackathonId, kind, name, places) VALUES (?, 'geral', 'Grande Prêmio E2E', 1) RETURNING id")
    .get<{ id: number }>(DEPOIS);
  await db.prepare("INSERT INTO prize_winners (categoryId, teamId, place) VALUES (?, ?, 1)").run(cat!.id, ids.campeao);
  await db.prepare("INSERT INTO jury_results (hackathonId) VALUES (?)").run(DEPOIS);
});

async function noOverflow(page: Page, shot: string) {
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${shot}.png`, fullPage: true });
}

test.describe("projetos da edição — matriz de visibilidade", () => {
  test("antes do prazo: só a contagem, nenhum título vaza", async ({ memberPage: page }) => {
    await page.goto(`/h/${ANTES}/projetos`);
    await expect(page.getByTestId("entries-counts")).toHaveText("2 times · 1 entregue");
    await expect(page.getByTestId("entries-locked")).toBeVisible();
    await expect(page.getByText("Projeto Secreto")).toHaveCount(0);
    await expect(page.getByText("Rascunho Secreto")).toHaveCount(0);
  });

  test("ficha de projeto antes do prazo não mostra conteúdo pra quem é de fora", async ({ memberPage: page }) => {
    await page.goto(`/p/${ids.antesEnviado}`);
    await expect(page.getByTestId("project-hidden")).toContainText("em construção");
    await expect(page.getByText("não pode vazar")).toHaveCount(0);
  });

  test("bloco de prazos na página da edição", async ({ memberPage: page }) => {
    await page.goto(`/h/${ANTES}`);
    const block = page.getByTestId("edition-deadlines");
    await expect(block).toBeVisible();
    await expect(block.getByText("prazo de entrega")).toBeVisible();
    await expect(block.getByText("formação de times")).toBeVisible();
    await expect(block.getByRole("link", { name: /2 times · 1 entregue/ })).toHaveAttribute("href", `/h/${ANTES}/projetos`);
    // o arquivo da edição também não expõe projeto antes do prazo
    await expect(page.getByText("Projeto Secreto")).toHaveCount(0);
    await noOverflow(page, "edicao-prazos-390");
  });

  test("depois do prazo e publicado: resultados, mostruário e todas as entregas com status", async ({ memberPage: page }) => {
    await page.goto(`/h/${DEPOIS}/projetos`);
    await expect(page.getByTestId("entries-counts")).toHaveText("3 times · 2 entregues");
    const results = page.getByTestId("entries-results");
    await expect(results.getByText("Grande Prêmio E2E")).toBeVisible();
    await expect(results.getByRole("link", { name: /Fila Zero/ })).toHaveAttribute("href", `/p/${ids.campeao}`);
    const all = page.getByTestId("entries-all");
    await expect(all.getByText("Time Atrasado")).toBeVisible();
    await expect(all.getByText("não entregue")).toHaveCount(1);
    await expect(all.getByText("entregue", { exact: true })).toHaveCount(2);
    const showcase = page.getByTestId("entries-showcase");
    await expect(showcase.getByText("Planilha Viva")).toBeVisible();
    await expect(showcase.getByText("Nunca Enviado")).toHaveCount(0);
    await noOverflow(page, "projetos-edicao-390");
  });

  test("filtro 'tem vídeo' deixa só quem tem vídeo", async ({ memberPage: page }) => {
    await page.goto(`/h/${DEPOIS}/projetos`);
    await page.getByRole("link", { name: "tem vídeo" }).click();
    await expect(page).toHaveURL(/video=1/);
    const showcase = page.getByTestId("entries-showcase");
    await expect(showcase.getByText("Fila Zero")).toBeVisible();
    await expect(showcase.getByText("Planilha Viva")).toHaveCount(0);
  });

  test("ficha /p na ordem da spec: tagline, selos, vídeos, versão avaliada e o diário", async ({ memberPage: page }) => {
    await page.goto(`/p/${ids.campeao}`);
    await expect(page.getByRole("heading", { name: "Fila Zero", exact: true })).toBeVisible();
    await expect(page.getByText("fila do posto de saúde em tempo real")).toBeVisible();
    await expect(page.getByText("1º lugar · Grande Prêmio E2E")).toBeVisible();
    await expect(page.getByRole("link", { name: /vídeo do time/ })).toHaveAttribute("href", "https://youtu.be/e2e034");
    await expect(page.getByRole("link", { name: /apresentação no palco/ })).toHaveAttribute("href", "https://youtu.be/e2e034-palco");
    await expect(page.getByText("protótipo no Figma antes do evento")).toBeVisible();
    await expect(page.getByTestId("judged-version")).toContainText("v1");
    // migration 044 — o "depois do hackathon" virou o diário do projeto
    await expect(page.getByText("piloto com a prefeitura em novembro")).toHaveCount(0);
    await expect(page.getByTestId("project-diary")).toBeVisible();
    // ordem: vídeo antes da descrição; versão avaliada antes do diário
    const text = await page.getByTestId("project-page").innerText();
    expect(text.indexOf("vídeo do time")).toBeLessThan(text.indexOf("Problema: fila"));
    expect(text.indexOf("versão avaliada")).toBeLessThan(text.indexOf("Diário do projeto"));
    await noOverflow(page, "ficha-projeto-390");
  });
});

test.describe("entrega — portas trancadas sem login", () => {
  test("aba /admin/h/[id]/entregas exige login", async ({ page }) => {
    await page.goto(`/admin/h/${DEPOIS}/entregas`);
    await expect(page).toHaveURL(/sign-in|sign-up|clerk/i, { timeout: 15000 });
  });

  test("APIs de envio, painel e cron respondem 401 JSON", async ({ request }) => {
    for (const [method, path, data] of [
      ["GET", `/api/hackathons/${ANTES}/entry`, undefined],
      ["PATCH", `/api/hackathons/${ANTES}/entry`, { title: "x" }],
      ["POST", `/api/hackathons/${ANTES}/entry`, undefined],
      ["GET", `/api/admin/hackathons/${ANTES}/entregas`, undefined],
      ["PATCH", `/api/admin/hackathons/${ANTES}/entregas`, { requireVideo: true }],
      ["POST", `/api/admin/hackathons/${ANTES}/entregas/${ids.antesEnviado}`, { reason: "x" }],
      ["POST", `/api/admin/hackathons/${ANTES}/premios`, { kind: "geral", name: "x" }],
      ["POST", `/api/cron/submissions`, undefined],
    ] as const) {
      const res = await request.fetch(path, { method, data });
      expect(res.status(), `${method} ${path}`).toBe(401);
      expect(res.headers()["content-type"]).toContain("application/json");
    }
  });
});
