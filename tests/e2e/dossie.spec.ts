import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { E2E_MEMBER_EMAIL, test } from "./auth";
import { openE2eDb } from "./db";

// Dossiê de evidência (roadmap 037 #10, migration 029). O time responde a
// declaração e envia a entrega com repositório do GitHub; o server lê os
// commits no GitHub falso (tests/e2e/github-mock.mjs, nunca a rede) e o
// organizador vê a linha do tempo contra a janela do evento, com sinais e
// o aviso de que a decisão é dele. Tudo a 390px, sem scroll de lado.

const ED = "e2e-dossie";
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

async function seed(request: APIRequestContext) {
  await request.get("/api/health");
  const db = openE2eDb();
  // janela: começou há 24 h, prazo de entrega em 5 h
  await db
    .prepare(
      `INSERT INTO hackathons (id, name, organizer, startsAt, endsAt, format, registrationUrl, tags, active, source,
                               submissionDeadline, submissionGraceMinutes)
       VALUES (?, 'E2E Dossiê', 'Hack Inova E2E', ?, ?, 'presencial', '/h/e2e-dossie', '[]', 1, 'painel', ?, 0)
       ON CONFLICT (id) DO UPDATE SET startsAt = excluded.startsAt, endsAt = excluded.endsAt,
         submissionDeadline = excluded.submissionDeadline, active = 1`,
    )
    .run(ED, new Date(Date.now() - 24 * H).toISOString(), new Date(Date.now() + 24 * H).toISOString(), dbTime(Date.now() + 5 * H));
  for (const sql of [
    "DELETE FROM project_dossiers WHERE teamId IN (SELECT id FROM teams WHERE hackathonId = ?)",
    "DELETE FROM announcements WHERE hackathonId = ?",
    "DELETE FROM submission_events WHERE hackathonId = ?",
    "DELETE FROM project_submissions WHERE teamId IN (SELECT id FROM teams WHERE hackathonId = ?)",
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
  await db
    .prepare("INSERT INTO edition_roles (hackathonId, memberId, role) VALUES (?, ?, 'organizador') ON CONFLICT DO NOTHING")
    .run(ED, me.id);
  await db.prepare("INSERT INTO registrations (memberId, hackathonId, status) VALUES (?, ?, 'approved')").run(me.id, ED);

  async function team(name: string, username: string, repoUrl: string | null, title: string) {
    const t = await db
      .prepare("INSERT INTO teams (hackathonId, name, placement) VALUES (?, ?, 0) RETURNING id")
      .get<{ id: number }>(ED, name);
    await db
      .prepare("INSERT INTO members (clerkId, username, email) VALUES (?, ?, ?) ON CONFLICT DO NOTHING")
      .run(`clerk_${username}`, username, `${username}@e2e.dev`);
    await db.prepare("INSERT INTO team_members (teamId, username) VALUES (?, ?)").run(t!.id, username);
    await db
      .prepare(
        `INSERT INTO team_projects (teamId, title, tagline, description, priorWork, technologies, repoUrl)
         VALUES (?, ?, 'o projeto numa frase', 'descrição do projeto', 'TCC de 2025 sobre fila', '["Next.js"]', ?)`,
      )
      .run(t!.id, title, repoUrl);
    return t!.id;
  }
  ids.reciclado = await team("Time Reciclado", me.username, "https://github.com/e2e-dossie/reciclado", "Fila Velha");
  ids.limpo = await team("Time Limpo", "dossie_limpo", "https://github.com/e2e-dossie/limpo", "Fila Nova");
  ids.privado = await team("Time Privado", "dossie_privado", "https://github.com/e2e-dossie/privado", "Fila Fechada");
  ids.limite = await team("Time Limite", "dossie_limite", "https://github.com/e2e-dossie/limite", "Fila Lenta");
  ids.semRepo = await team("Time Sem Repo", "dossie_sem", null, "Fila Sem Código");
}

test.describe.configure({ mode: "serial" });

test.describe("dossiê de evidência", () => {
  test.beforeAll(async ({ request }) => {
    await seed(request);
  });

  test("anônimo não lê nem atualiza o dossiê", async ({ request }) => {
    expect((await request.get(`/api/admin/hackathons/${ED}/dossie`)).status()).toBe(401);
    expect((await request.post(`/api/admin/hackathons/${ED}/dossie/${ids.limpo}`)).status()).toBe(401);
  });

  test("time responde a declaração e envia; a coleta roda no envio", async ({ memberPage: page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/h/${ED}/entrega`);
    const prior = page.getByTestId("decl-priorExisted");
    const ai = page.getByTestId("decl-usedAi");
    await expect(prior).toContainText("já existia algo do projeto antes do evento?");
    await prior.getByLabel("sim", { exact: true }).check();
    await ai.getByLabel("sim", { exact: true }).check();
    await page.getByLabel(/uso de IA/).fill("Claude pra revisar o texto do pitch");
    await expect(page.getByText(/último salvamento/)).toBeVisible({ timeout: 15_000 });
    await noHorizontalScroll(page);
    await shot(page, "dossie-entrega-390");

    page.once("dialog", (d) => void d.accept());
    await page.getByRole("button", { name: /enviar versão 1/ }).click();
    await expect(page.getByText("versão 1 enviada — o time recebeu a confirmação")).toBeVisible({ timeout: 20_000 });
  });

  test("organizador vê a linha do tempo, os sinais e o aviso de que a decisão é dele", async ({ memberPage: page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/admin/h/${ED}/dossie`);
    await expect(page.getByTestId("admin-tabs").getByRole("link", { name: "dossiê" })).toHaveAttribute("aria-current", "page");
    const aviso = page.getByTestId("dossie-aviso");
    await expect(aviso).toContainText("O dossiê só sinaliza.");
    await expect(aviso).toContainText("a decisão é da organização");

    const rec = page.getByTestId(`dossie-time-${ids.reciclado}`);
    await expect(rec.getByTestId("dossie-antes")).toHaveText("6");
    await expect(rec.getByTestId("dossie-durante")).toHaveText("1");
    await expect(rec.getByTestId("dossie-depois")).toHaveText("0");
    const sinais = rec.getByTestId("dossie-sinais");
    await expect(sinais).toContainText("repositório criado antes do evento");
    await expect(sinais).toContainText("maioria dos commits antes do início (6 de 7)");
    const decl = rec.getByTestId("dossie-declaracao");
    await expect(decl).toContainText("TCC de 2025 sobre fila");
    await expect(decl).toContainText("Claude pra revisar o texto do pitch");
    await rec.getByText("ver commits lidos (7)").click();
    await expect(rec.getByText("tcc: capítulo 1")).toBeVisible();

    // time sem repositório: estado vazio com orientação
    await expect(page.getByTestId(`dossie-time-${ids.semRepo}`)).toContainText("O time não informou repositório.");
    await noHorizontalScroll(page);
    await shot(page, "dossie-painel-390");
  });

  test("atualizar lê o GitHub; privado e limite mostram o motivo", async ({ memberPage: page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/admin/h/${ED}/dossie`);

    const limpo = page.getByTestId(`dossie-time-${ids.limpo}`);
    await expect(limpo).toContainText("Repositório ainda não lido.");
    await limpo.getByRole("button", { name: "atualizar" }).click();
    await expect(limpo.getByRole("status").filter({ hasText: "5 commits lidos" })).toBeVisible();
    await expect(limpo.getByTestId("dossie-sem-sinal")).toBeVisible();
    await expect(limpo.getByTestId("dossie-durante")).toHaveText("5");
    // de novo logo em seguida: o servidor segura (1 min por time)
    await limpo.getByRole("button", { name: "atualizar" }).click();
    await expect(limpo.getByRole("alert")).toContainText("atualizado agora há pouco");

    const priv = page.getByTestId(`dossie-time-${ids.privado}`);
    await priv.getByRole("button", { name: "atualizar" }).click();
    await expect(priv.getByTestId("dossie-erro")).toContainText("não encontrado ou privado");

    const lim = page.getByTestId(`dossie-time-${ids.limite}`);
    await lim.getByRole("button", { name: "atualizar" }).click();
    await expect(lim.getByTestId("dossie-erro")).toContainText("O GitHub limitou as consultas");
    await noHorizontalScroll(page);
    await shot(page, "dossie-atualizar-390");
  });
});
