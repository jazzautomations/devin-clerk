import { expect, type Page } from "@playwright/test";
import { E2E_MEMBER_EMAIL, memberRequest, test } from "./auth";
import { openE2eDb } from "./db";

// Desafios abertos (migration 053): o membro de teste é dono de uma
// comunidade e membro comum de outra. Cria e publica um desafio (com
// pré-visualização), leva 403 ao tentar criar onde é só membro, entrega no
// desafio da outra comunidade (entregas escondidas até o prazo, atrasada dá
// 400, time alheio dá 403) e publica o resultado do próprio desafio, que
// avisa cada participante. "desafios" no menu e tudo em 390px.

const SHOTS = process.env.E2E_SHOT_DIR;
const MINE = "e2e-desafios-org";
const MINE2 = "e2e-desafios-org-dois";
const OTHER = "e2e-desafios-outra";
const OTHER_TITLE = "E2E Desafio da Outra";
const MY_TITLE = "E2E Fila do bandejão";
const HACK = "hack-inova-unifacens-2026";
const TEAM = "E2E Desafio Time Alheio";

async function noHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "scroll horizontal").toBeLessThanOrEqual(0);
}
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

/** hidratação de verdade: ao montar, o React pendura __reactProps$/__reactFiber$ nos nós que gerencia */
async function hydrated(page: Page, selector: string) {
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      return !!el && Object.keys(el).some((k) => k.startsWith("__react"));
    },
    selector,
    { timeout: 15_000 },
  );
}

/** "2026-11-14T18:00" daqui a N dias, no relógio de Brasília */
function brtInput(days: number) {
  const d = new Date(Date.now() + days * 86_400_000 - 3 * 3_600_000);
  return d.toISOString().slice(0, 16);
}

const SEEDED = ["e2e_desafio_dono", "e2e_desafio_ana", "e2e_desafio_beto"] as const;
type Ids = { me: number; dono: number; ana: number; beto: number; mine: number; other: number; otherChallenge: number };
let ids: Ids;

async function cleanup() {
  const db = openE2eDb();
  // a denúncia do último teste bloqueia a Ana pro membro de teste: desfaz
  await db
    .prepare(
      `DELETE FROM member_blocks WHERE "blockedId" IN (SELECT id FROM members WHERE username IN (?, ?, ?))
          OR "memberId" IN (SELECT id FROM members WHERE username IN (?, ?, ?))`,
    )
    .run(...SEEDED, ...SEEDED);
  await db.prepare(`DELETE FROM reports WHERE "targetType" IN ('desafio', 'desafio_entrega')`).run();
  await db.prepare("DELETE FROM communities WHERE slug IN (?, ?, ?)").run(MINE, MINE2, OTHER);
  await db
    .prepare("DELETE FROM notifications WHERE type IN ('desafio_aberto', 'desafio_resultado', 'desafio_entrega_removida') AND text LIKE ?")
    .run("%E2E%");
  const t = await db.prepare("SELECT id FROM teams WHERE hackathonId = ? AND name = ?").get<{ id: number }>(HACK, TEAM);
  if (t) {
    await db.prepare("DELETE FROM team_projects WHERE teamId = ?").run(t.id);
    await db.prepare("DELETE FROM team_members WHERE teamId = ?").run(t.id);
    await db.prepare("DELETE FROM teams WHERE id = ?").run(t.id);
  }
}

async function seed() {
  await cleanup();
  const db = openE2eDb();
  const me = await db.prepare("SELECT id FROM members WHERE email = ?").get<{ id: number }>(E2E_MEMBER_EMAIL);
  expect(me, "membro de teste do global-setup").toBeTruthy();
  const seeded: Record<string, number> = {};
  for (const u of SEEDED) {
    await db
      .prepare("INSERT OR IGNORE INTO members (clerkId, username, email, name) VALUES (?, ?, ?, ?)")
      .run(`clerk_${u}`, u, `${u}@e2e.invalid`, u.replace("e2e_desafio_", "E2E ").replace(/^E2E (\w)/, (_, c: string) => `E2E ${c.toUpperCase()}`));
    seeded[u] = (await db.prepare("SELECT id FROM members WHERE username = ?").get<{ id: number }>(u))!.id;
  }
  const mine = await db
    .prepare(`INSERT INTO communities (slug, name, city, "createdBy") VALUES (?, 'E2E Desafios Org', 'Recife, PE', ?) RETURNING id`)
    .get<{ id: number }>(MINE, me!.id);
  await db.prepare(`INSERT INTO community_members ("communityId", "memberId", role) VALUES (?, ?, 'dono')`).run(mine!.id, me!.id);
  await db.prepare(`INSERT INTO community_members ("communityId", "memberId", role) VALUES (?, ?, 'membro')`).run(mine!.id, seeded.e2e_desafio_ana);
  const other = await db
    .prepare(`INSERT INTO communities (slug, name, city, "createdBy") VALUES (?, 'E2E Desafios Outra', 'Natal, RN', ?) RETURNING id`)
    .get<{ id: number }>(OTHER, seeded.e2e_desafio_dono);
  await db.prepare(`INSERT INTO community_members ("communityId", "memberId", role) VALUES (?, ?, 'dono')`).run(other!.id, seeded.e2e_desafio_dono);
  await db.prepare(`INSERT INTO community_members ("communityId", "memberId", role) VALUES (?, ?, 'membro')`).run(other!.id, me!.id);
  const ch = await db
    .prepare(
      `INSERT INTO open_challenges ("communityId", title, brief, prize, deadline, status, "createdBy", "publishedAt", "sponsorName")
       VALUES (?, ?, 'Um bot que responde dúvida de matrícula.', 'mentoria', ?, 'aberto', ?, sqlite_now(), 'Livraria Boa')
       RETURNING id`,
    )
    .get<{ id: number }>(other!.id, OTHER_TITLE, `${brtInput(5)}:00-03:00`, seeded.e2e_desafio_dono);
  const team = await db.prepare("INSERT INTO teams (hackathonId, name) VALUES (?, ?) RETURNING id").get<{ id: number }>(HACK, TEAM);
  await db.prepare("INSERT INTO team_members (teamId, username) VALUES (?, 'e2e_desafio_beto')").run(team!.id);
  await db.prepare("INSERT INTO team_projects (teamId, title) VALUES (?, 'E2E Projeto do Beto')").run(team!.id);
  ids = {
    me: me!.id,
    dono: seeded.e2e_desafio_dono,
    ana: seeded.e2e_desafio_ana,
    beto: seeded.e2e_desafio_beto,
    mine: mine!.id,
    other: other!.id,
    otherChallenge: ch!.id,
  };
}

const myChallengeId = async () =>
  (await openE2eDb().prepare(`SELECT id FROM open_challenges WHERE "communityId" = ? AND title = ?`).get<{ id: number }>(ids.mine, MY_TITLE))
    ?.id;

test.describe.configure({ mode: "serial" });

test.describe("desafios abertos", () => {
  test.beforeAll(seed);
  test.afterAll(cleanup);

  test("'desafios' no menu, depois de 'hackathons'; vazio da comunidade tem o caminho pra criar (390px)", async ({ memberPage: page }) => {
    await page.goto("/radar");
    const nav = page.getByRole("navigation", { name: "Navegação principal" });
    // allTextContents não espera: com a máquina carregada a nav ainda não tinha os links
    await expect(nav.getByRole("link", { name: "desafios" })).toBeVisible();
    const labels = await nav.getByRole("link").allTextContents();
    // spec 046 onda 2: o feed é a primeira porta do menu
    expect(labels[0]).toBe("feed");
    expect(labels.slice(1, 3)).toEqual(["hackathons", "desafios"]);
    await nav.getByRole("link", { name: "desafios" }).click();
    await expect(page).toHaveURL(/\/desafios$/);
    await expect(nav.getByRole("link", { name: "desafios" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("desafios-abertos")).toContainText(OTHER_TITLE);
    await expect(page.getByTestId("desafios-abertos")).toContainText("patrocinado por Livraria Boa");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/desafios?comunidade=${MINE}`);
    await expect(page.getByTestId("desafios-vazio")).toContainText("Nenhum desafio aberto. Sua comunidade pode criar um.");
    // o membro de teste pode organizar outras comunidades de outros specs: o link da dele está lá
    await expect(page.locator(`[data-testid="desafios-criar"] a[href="/comunidade/${MINE}/desafios/novo"]`)).toHaveCount(1);
    await noHorizontalScroll(page);
    await expect(async () => {
      await page.getByRole("button", { name: "menu", exact: true }).click();
      await expect(page.getByRole("button", { name: "fechar", exact: true })).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15000 });
    await expect(page.getByRole("navigation", { name: "Navegação principal (menu)" }).getByRole("link", { name: /desafios/ })).toBeVisible();
    await shot(page, "desafios-vazio-390");
  });

  test("membro comum leva 403 ao criar; quem é de fora não abre o formulário", async ({ memberPage: page }) => {
    const req = await memberRequest(page);
    const res = await req.post("/api/open-challenges", {
      data: { community: OTHER, title: "Não posso", brief: "x", deadline: brtInput(3) },
    });
    expect(res.status()).toBe(403);
    const r = await page.goto(`/comunidade/${OTHER}/desafios/novo`);
    expect(r?.status()).toBe(404);
  });

  test("dono cria com pré-visualização e publica; membros recebem o aviso (390px)", async ({ memberPage: page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/comunidade/${MINE}/desafios/novo`);
    const form = page.getByTestId("desafio-form");
    // fills e cliques antes da hidratação não pegam no estado do React
    await hydrated(page, '[data-testid="desafio-form"]');
    await form.getByLabel("título").fill(MY_TITLE);
    await form.getByLabel("o que construir").fill("Mostre a fila do bandejão em tempo real.\nFunciona no celular.");
    await form.getByLabel("regras (opcional)").fill("Solo ou em time.");
    await page.getByTestId("desafio-deadline").fill(brtInput(4));
    await form.getByLabel("prêmio (opcional)").fill("R$ 500 pro 1º");
    await form.getByLabel("patrocinador (opcional)").fill("Padaria E2E");
    await noHorizontalScroll(page);

    await page.getByTestId("desafio-tab-ver").click();
    const preview = page.getByTestId("desafio-preview");
    await expect(preview.getByRole("heading", { name: MY_TITLE })).toBeVisible();
    await expect(preview).toContainText("patrocinado por Padaria E2E");
    await expect(preview).toContainText("R$ 500 pro 1º");
    await expect(preview).toContainText("(Brasília)");
    await noHorizontalScroll(page);
    await shot(page, "desafio-preview-390");
    await page.getByTestId("desafio-tab-escrever").click();

    // rascunho primeiro: ninguém é avisado
    await page.getByTestId("desafio-salvar").click();
    await expect(page.getByRole("heading", { name: "Continuar desafio" })).toBeVisible();
    await expect(page).toHaveURL(/\?rascunho=\d+$/);
    const db = openE2eDb();
    expect(await db.prepare(`SELECT COUNT(*) AS n FROM notifications WHERE "memberId" = ? AND type = 'desafio_aberto'`).get(ids.ana)).toEqual({
      n: 0,
    });

    page.once("dialog", (d) => d.accept());
    await page.getByTestId("desafio-publicar").click();
    await expect(page).toHaveURL(/\/desafios\/\d+$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(MY_TITLE);
    await expect(page.getByTestId("desafio-sponsor")).toContainText("patrocinado por Padaria E2E");
    await expect(page.getByTestId("desafio-status")).toContainText("aberto");
    await expect(page.getByTestId("desafio-organiza")).toHaveText("Quem organiza a comunidade não entrega no desafio dela.");
    await noHorizontalScroll(page);
    await shot(page, "desafio-publicado-390");

    const id = await myChallengeId();
    const note = await db
      .prepare(`SELECT text, href FROM notifications WHERE "memberId" = ? AND type = 'desafio_aberto'`)
      .all(ids.ana);
    expect(note).toEqual([{ text: `E2E Desafios Org abriu o desafio "${MY_TITLE}", patrocinado por Padaria E2E.`, href: `/desafios/${id}` }]);
  });

  test("entrega no desafio da outra comunidade: entregas escondidas até o prazo, time alheio 403 (390px)", async ({ memberPage: page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/desafios/${ids.otherChallenge}`);
    await expect(page.getByTestId("desafio-contagem")).toContainText("0 entregas até agora");
    const form = page.getByTestId("entry-form");
    await hydrated(page, '[data-testid="entry-form"]');
    await form.getByLabel(/^repo/).fill("http://github.com/e2e/bot");
    await form.getByLabel("o que você fez").fill("Bot no Telegram que lê o edital.");
    await page.getByTestId("entry-submit").click();
    await expect(page.getByTestId("entry-msg")).toHaveText("O repo precisa de link https://");
    await form.getByLabel(/^repo/).fill("https://github.com/e2e/bot");
    await page.getByTestId("entry-submit").click();
    await expect(page.getByTestId("entry-msg")).toHaveText("Entrega salva. Dá pra mudar até o prazo.");
    await expect(page.getByTestId("desafio-contagem")).toContainText("1 entrega até agora");
    await expect(page.getByRole("heading", { name: "Sua entrega" })).toBeVisible();
    await expect(page.getByTestId("desafio-entregas")).toHaveCount(0);
    await noHorizontalScroll(page);
    await shot(page, "desafio-entrega-390");

    // outra pessoa entrega também; antes do prazo ninguém vê a entrega dela
    const db = openE2eDb();
    await db
      .prepare(`INSERT INTO open_challenge_entries ("challengeId", "memberId", "repoUrl", summary) VALUES (?, ?, 'https://github.com/ana/bot', 'bot da ana')`)
      .run(ids.otherChallenge, ids.ana);
    await page.reload();
    await expect(page.getByTestId("desafio-contagem")).toContainText("2 entregas até agora");
    await expect(page.getByText("bot da ana")).toHaveCount(0);

    const req = await memberRequest(page);
    const team = await db.prepare("SELECT id FROM teams WHERE name = ?").get<{ id: number }>(TEAM);
    const alheio = await req.post(`/api/open-challenges/${ids.otherChallenge}/entry`, { data: { teamId: team!.id, summary: "peguei" } });
    expect(alheio.status()).toBe(403);
  });

  test("depois do prazo: entrega atrasada dá 400 e as entregas aparecem", async ({ memberPage: page }) => {
    const db = openE2eDb();
    await db.prepare("UPDATE open_challenges SET deadline = '2020-01-01T10:00:00-03:00' WHERE id = ?").run(ids.otherChallenge);
    const req = await memberRequest(page);
    const late = await req.post(`/api/open-challenges/${ids.otherChallenge}/entry`, {
      data: { repoUrl: "https://github.com/e2e/bot", summary: "atrasado" },
    });
    expect(late.status()).toBe(400);
    expect((await late.json()).error).toBe("O prazo deste desafio acabou. Não dá mais pra entregar.");

    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/desafios/${ids.otherChallenge}`);
    await expect(page.getByTestId("desafio-status")).toContainText("encerrado");
    await expect(page.getByTestId("desafio-entrega")).toHaveCount(2);
    await expect(page.getByTestId("desafio-entregas")).toContainText("bot da ana");
    await expect(page.getByTestId("desafio-entregas")).toContainText("Bot no Telegram que lê o edital.");
    await expect(page.getByTestId("desafio-aguardando")).toContainText("@e2e_desafio_dono");
    await expect(page.getByTestId("entry-form")).toHaveCount(0);
    await noHorizontalScroll(page);
  });

  test("quem criou escolhe os três primeiros e publica; cada participante é avisado (390px)", async ({ memberPage: page }) => {
    const id = (await myChallengeId())!;
    const db = openE2eDb();
    await db
      .prepare(
        `INSERT INTO open_challenge_entries ("challengeId", "memberId", "repoUrl", summary)
         VALUES (?, ?, 'https://github.com/ana/fila', 'fila da ana'), (?, ?, 'https://github.com/beto/fila', 'fila do beto')`,
      )
      .run(id, ids.ana, id, ids.beto);
    await db.prepare("UPDATE open_challenges SET deadline = '2020-01-01T10:00:00-03:00' WHERE id = ?").run(id);

    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`/desafios/${id}`);
    await expect(page.getByTestId("result-form")).toBeVisible();
    await expect(page.getByTestId("result-submit")).toBeDisabled();
    const anaEntry = await db
      .prepare(`SELECT id FROM open_challenge_entries WHERE "challengeId" = ? AND "memberId" = ?`)
      .get<{ id: number }>(id, ids.ana);
    const betoEntry = await db
      .prepare(`SELECT id FROM open_challenge_entries WHERE "challengeId" = ? AND "memberId" = ?`)
      .get<{ id: number }>(id, ids.beto);
    await hydrated(page, '[data-testid="result-place-1"]');
    await page.getByTestId("result-place-1").selectOption(String(betoEntry!.id));
    await page.getByTestId("result-place-2").selectOption(String(anaEntry!.id));
    await noHorizontalScroll(page);
    await shot(page, "desafio-resultado-form-390");
    page.once("dialog", (d) => d.accept());
    await page.getByTestId("result-submit").click();

    const result = page.getByTestId("desafio-resultado");
    await expect(result).toBeVisible();
    await expect(result.getByRole("listitem").first()).toContainText("1º lugar");
    await expect(result.getByRole("listitem").first()).toContainText("E2E Beto");
    await expect(result.getByRole("listitem").nth(1)).toContainText("E2E Ana");
    await expect(page.getByTestId("desafio-status")).toContainText("resultado saiu");
    await expect(page.getByTestId("result-form")).toHaveCount(0);
    await noHorizontalScroll(page);
    await shot(page, "desafio-resultado-390");

    const notes = await db
      .prepare(`SELECT "memberId", text FROM notifications WHERE type = 'desafio_resultado' AND href = ? ORDER BY "memberId"`)
      .all<{ memberId: number; text: string }>(`/desafios/${id}`);
    expect(notes).toEqual(
      [
        { memberId: ids.ana, text: `Saiu o resultado de "${MY_TITLE}": sua entrega ficou em 2º lugar.` },
        { memberId: ids.beto, text: `Saiu o resultado de "${MY_TITLE}": sua entrega ficou em 1º lugar.` },
      ].sort((a, b) => a.memberId - b.memberId),
    );

    // publicar de novo não muda nada
    const req = await memberRequest(page);
    const again = await req.post(`/api/open-challenges/${id}/result`, { data: { places: [{ entryId: anaEntry!.id, place: 1 }] } });
    expect(again.status()).toBe(409);
  });

  test("/desafios lista o encerrado com resultado e filtra por comunidade (390px)", async ({ memberPage: page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto("/desafios");
    const closed = page.getByTestId("desafios-encerrados");
    await expect(closed.getByTestId("desafio-row").filter({ hasText: MY_TITLE })).toContainText("resultado saiu");
    await expect(closed.getByTestId("desafio-row").filter({ hasText: OTHER_TITLE })).toContainText("encerrado");
    await page.getByTestId("desafios-filtro").getByRole("link", { name: "E2E Desafios Org" }).click();
    await expect(page).toHaveURL(new RegExp(`comunidade=${MINE}$`));
    await expect(page.getByTestId("desafios-encerrados").getByTestId("desafio-row")).toHaveCount(1);
    await expect(page.getByTestId("desafios-encerrados")).toContainText(MY_TITLE);
    await noHorizontalScroll(page);
    await shot(page, "desafios-lista-390");
  });

  test("quem organiza duas comunidades abre o menu de criar inteiro na tela (390px)", async ({ memberPage: page }) => {
    const db = openE2eDb();
    const c = await db
      .prepare(`INSERT INTO communities (slug, name, city, "createdBy") VALUES (?, 'E2E Desafios Segunda Comunidade de Nome Comprido', 'Recife, PE', ?) RETURNING id`)
      .get<{ id: number }>(MINE2, ids.me);
    await db.prepare(`INSERT INTO community_members ("communityId", "memberId", role) VALUES (?, ?, 'dono')`).run(c!.id, ids.me);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/desafios");
    const menu = page.getByTestId("desafios-criar-menu");
    await menu.locator("summary").click();
    const list = menu.locator("ul");
    await expect(list.locator(`a[href="/comunidade/${MINE2}/desafios/novo"]`)).toBeVisible();
    const box = (await list.boundingBox())!;
    expect(box.x, "menu começa dentro da tela").toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, "menu termina dentro da tela").toBeLessThanOrEqual(390);
    await noHorizontalScroll(page);
    await shot(page, "desafios-criar-menu-390");
  });

  test("denunciar entrega vai pra fila da comunidade e esconde a pessoa; quem organiza tira entrega e desafio do ar (390px)", async ({
    memberPage: page,
  }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    const db = openE2eDb();
    // na outra comunidade o membro de teste é só membro: denuncia a entrega da Ana
    await page.goto(`/desafios/${ids.otherChallenge}`);
    const ana = page.getByTestId("desafio-entrega").filter({ hasText: "bot da ana" });
    await expect(page.getByTestId("entrega-tirar")).toHaveCount(0);
    await hydrated(page, '[data-testid="report-open"]');
    await ana.getByTestId("report-open").click();
    const dialog = ana.getByTestId("report-dialog");
    await dialog.getByLabel("spam ou propaganda").check();
    await dialog.getByTestId("report-send").click();
    await expect(dialog).toContainText("Você não vai mais ver conteúdo de @e2e_desafio_ana.");
    await dialog.getByRole("button", { name: "fechar", exact: true }).last().click();
    await expect(page.getByTestId("desafio-entregas")).not.toContainText("bot da ana");
    await expect(page.getByTestId("desafio-entregas")).toContainText("Bot no Telegram que lê o edital.");
    const anaEntry = await db
      .prepare(`SELECT id FROM open_challenge_entries WHERE "challengeId" = ? AND "memberId" = ?`)
      .get<{ id: number }>(ids.otherChallenge, ids.ana);
    expect(
      await db.prepare(`SELECT "communityId", "targetMemberId" FROM reports WHERE "targetType" = 'desafio_entrega' AND "targetId" = ?`).all(String(anaEntry!.id)),
    ).toEqual([{ communityId: ids.other, targetMemberId: ids.ana }]);
    await noHorizontalScroll(page);
    await shot(page, "desafio-denuncia-390");

    // no próprio desafio, o dono tira a entrega do Beto: some da lista e do pódio, o Beto é avisado
    const id = (await myChallengeId())!;
    await page.goto(`/desafios/${id}`);
    const beto = page.getByTestId("desafio-entrega").filter({ hasText: "fila do beto" });
    await hydrated(page, '[data-testid="entrega-tirar"]');
    page.once("dialog", (d) => d.accept());
    await beto.getByTestId("entrega-tirar").click();
    await expect(page.getByTestId("desafio-entregas")).not.toContainText("fila do beto");
    await expect(page.getByTestId("desafio-resultado")).not.toContainText("E2E Beto");
    expect(await db.prepare(`SELECT text FROM notifications WHERE "memberId" = ? AND type = 'desafio_entrega_removida'`).all(ids.beto)).toEqual([
      { text: `A organização tirou sua entrega de "${MY_TITLE}".` },
    ]);

    // e tira o desafio inteiro do ar: só a organização ainda abre a página
    page.once("dialog", (d) => d.accept());
    await page.getByTestId("desafio-tirar").click();
    await expect(page.getByTestId("desafio-fora-do-ar")).toBeVisible();
    await noHorizontalScroll(page);
    await page.goto("/desafios");
    await expect(page.getByTestId("desafios-page")).not.toContainText(MY_TITLE);
  });
});
