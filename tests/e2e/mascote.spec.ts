import { expect, type Page } from "@playwright/test";
import { AUTH_FILE, E2E_MEMBER_EMAIL, memberRequest, test } from "./auth";
import { openE2eDb } from "./db";

// Bicho do builder (migration 043): SVG público com CSP e cache por hash,
// criador em /perfil/bicho (trocar, sortear, desfazer, salvar e recarregar),
// 400 por campo, bicho no /perfil e no /u, fallback sem WebGL, passo do
// /bem-vindo e 390px sem scroll horizontal.

const SHOTS = process.env.E2E_SHOT_DIR;

async function me() {
  return (await openE2eDb()
    .prepare("SELECT id, username FROM members WHERE email = ?")
    .get<{ id: number; username: string }>(E2E_MEMBER_EMAIL))!;
}
async function salvo(): Promise<Record<string, string> | null> {
  const r = await openE2eDb().prepare("SELECT mascote FROM members WHERE email = ?").get<{ mascote: string | null }>(E2E_MEMBER_EMAIL);
  return r?.mascote ? JSON.parse(r.mascote) : null;
}
async function limpar() {
  await openE2eDb().prepare(`UPDATE members SET mascote = NULL, "mascoteUpdatedAt" = NULL WHERE email = ?`).run(E2E_MEMBER_EMAIL);
}
async function gravar(config: Record<string, unknown>) {
  await openE2eDb()
    .prepare(`UPDATE members SET mascote = ?, "mascoteUpdatedAt" = datetime('now') WHERE email = ?`)
    .run(JSON.stringify(config), E2E_MEMBER_EMAIL);
}
async function noHorizontalScroll(page: Page, onde: string) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(sw, `scroll horizontal em ${onde}`).toBeLessThanOrEqual(iw);
}
async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}
const marcado = (page: Page, campo: string, op: string) => expect(page.getByTestId(`mascote-op-${campo}-${op}`)).toHaveAttribute("aria-checked", "true");

const BICHO = {
  v: 1,
  especie: "foguete",
  corPrincipal: "papel",
  corDetalhe: "tijolo",
  olhos: "brilho",
  boca: "risada",
  topo: "coroa",
  roupa: "nada",
  mao: "balao",
  acessorio: "oculos",
  pose: "acena",
  cenario: "nada",
  nome: "Lançado",
};

test.describe.configure({ mode: "serial" });

test.describe("bicho do builder", () => {
  test.beforeAll(async ({ request }) => {
    await request.get("/api/health");
    await limpar();
  });
  test.afterAll(limpar);

  test("SVG público abre deslogado com CSP; ?v=hash é imutável", async ({ request }) => {
    const res = await request.get("/api/mascote/m/1");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toMatch(/^image\/svg\+xml/);
    expect(res.headers()["content-security-policy"]).toBe("default-src 'none'");
    expect(res.headers()["cache-control"]).toBe("public, max-age=300");
    const body = await res.text();
    expect(body.startsWith("<svg")).toBe(true);
    expect(body).not.toContain("<script");
    const hash = (res.headers()["etag"] ?? "").replace(/"/g, "");
    expect(hash).toMatch(/^[0-9a-z]+$/);
    const fixo = await request.get(`/api/mascote/m/1?v=${hash}`);
    expect(fixo.headers()["cache-control"]).toBe("public, max-age=31536000, immutable");
    // quem não existe ganha o bicho da semente, nunca imagem quebrada
    const nada = await request.get("/api/mascote/m/987654321");
    expect(nada.status()).toBe(200);
    expect((await nada.text()).startsWith("<svg")).toBe(true);
    // o próprio bicho exige login
    expect((await request.get("/api/members/me/mascote")).status()).toBe(401);
  });

  test("criador: troca na hora, desfaz, sorteia, salva e volta igual depois de recarregar", async ({ memberPage: page }) => {
    await page.goto("/perfil/bicho");
    const editor = page.getByTestId("mascote-editor");
    await expect(editor).toBeVisible();
    await expect(page.getByTestId("mascote-estado")).toHaveText("ainda não salvo");
    await expect(page.getByTestId("mascote-desfazer")).toBeDisabled();

    await page.getByTestId("mascote-op-especie-patinho").click();
    await marcado(page, "especie", "patinho");
    await page.getByTestId("mascote-aba-topo").click();
    await page.getByTestId("mascote-op-topo-cartola").click();
    await marcado(page, "topo", "cartola");
    // desfazer volta só o último passo
    await page.getByTestId("mascote-desfazer").click();
    await expect(page.getByTestId("mascote-op-topo-cartola")).toHaveAttribute("aria-checked", "false");
    await page.getByTestId("mascote-aba-especie").click();
    await marcado(page, "especie", "patinho");
    // o dado troca o visual e o desfazer devolve
    await page.getByTestId("mascote-sortear").click();
    await page.getByTestId("mascote-desfazer").click();
    await marcado(page, "especie", "patinho");

    await page.getByTestId("mascote-aba-topo").click();
    await page.getByTestId("mascote-op-topo-helice").click();
    await page.getByTestId("mascote-aba-cores").click();
    await page.getByTestId("mascote-op-corPrincipal-rosa").click();
    await page.getByTestId("mascote-aba-pose").click();
    await page.getByTestId("mascote-op-pose-danca").click();
    await page.getByTestId("mascote-aba-cenario").click();
    await page.getByTestId("mascote-op-cenario-palco").click();
    await page.getByTestId("mascote-nome").fill("Quackinho");
    await expect(page.getByTestId("mascote-nome-palco")).toHaveText("Quackinho");
    await page.getByTestId("mascote-salvar").click();
    await expect(page.getByTestId("mascote-estado")).toHaveText("salvo");
    expect(await salvo()).toMatchObject({ especie: "patinho", topo: "helice", corPrincipal: "rosa", pose: "danca", cenario: "palco", nome: "Quackinho" });
    await shot(page, "bicho-criador");

    await page.reload();
    await expect(page.getByTestId("mascote-nome")).toHaveValue("Quackinho");
    await marcado(page, "especie", "patinho");
    await page.getByTestId("mascote-aba-topo").click();
    await marcado(page, "topo", "helice");
    await expect(page.getByTestId("mascote-estado")).toHaveText("salvo");
  });

  test("nome com link não salva: mensagem no campo e 400 por campo na API", async ({ memberPage: page }) => {
    await page.goto("/perfil/bicho");
    await page.getByTestId("mascote-nome").fill("www.golpe.com");
    await page.getByTestId("mascote-salvar").click();
    await expect(page.locator("#mascote-nome-erro")).toHaveText("O nome não pode ter link.");
    const req = await memberRequest(page);
    const res = await req.put("/api/members/me/mascote", { data: { ...BICHO, especie: "dragao", olhos: "laser" } });
    expect(res.status()).toBe(400);
    const data = await res.json();
    expect(Object.keys(data.campos).sort()).toEqual(["especie", "olhos"]);
    expect(data.error).toBe("Escolha uma das espécies.");
  });

  test("o bicho salvo aparece no /perfil e no hero do /u", async ({ memberPage: page }) => {
    await gravar(BICHO);
    const eu = await me();
    await page.goto("/perfil");
    const sec = page.getByTestId("perfil-bicho");
    await expect(sec).toContainText("Lançado");
    await expect(sec).toContainText("Like não conta.");
    await expect(sec.getByTestId("mascote-viewer")).toBeVisible();
    await page.getByTestId("perfil-bicho-editar").click();
    await expect(page).toHaveURL(/\/perfil\/bicho$/);
    await page.goto(`/u/${eu.username}`);
    const hero = page.getByTestId("u-bicho");
    await expect(hero).toContainText("Lançado");
    await expect(hero).toContainText("foguete");
    await expect(hero.getByTestId("u-bicho-editar")).toBeVisible();
  });

  test("sem WebGL o preview cai pro <img> do SVG", async ({ browser, baseURL }) => {
    const ctx = await browser.newContext({ storageState: AUTH_FILE, baseURL });
    await ctx.addInitScript(() => {
      // simula navegador sem WebGL; os outros contextos passam direto
      const proto = HTMLCanvasElement.prototype as unknown as { getContext: (tipo: string, ...rest: unknown[]) => unknown };
      const orig = proto.getContext;
      proto.getContext = function (this: HTMLCanvasElement, tipo: string, ...rest: unknown[]) {
        if (String(tipo).startsWith("webgl") || tipo === "experimental-webgl") return null;
        return orig.call(this, tipo, ...rest);
      };
    });
    const page = await ctx.newPage();
    await page.goto("/perfil/bicho");
    const viewer = page.getByTestId("mascote-editor").getByTestId("mascote-viewer");
    await expect(viewer.getByTestId("mascote-svg")).toBeVisible();
    await page.waitForTimeout(800);
    await expect(viewer).toHaveAttribute("data-modo", "svg");
    await expect(viewer.locator("canvas")).toHaveCount(0);
    const src = await viewer.getByTestId("mascote-svg").getAttribute("src");
    expect(src).toMatch(/^data:image\/svg\+xml/);
    // trocar a espécie troca o desenho na hora
    await page.getByTestId("mascote-op-especie-mouse").click();
    await expect(viewer.getByTestId("mascote-svg")).not.toHaveAttribute("src", src!);
    await ctx.close();
  });

  test("com WebGL (quando o navegador tem), o canvas entra no lugar do <img>", async ({ memberPage: page }) => {
    await page.goto("/perfil/bicho");
    const viewer = page.getByTestId("mascote-editor").getByTestId("mascote-viewer");
    await expect(viewer).toBeVisible();
    const temGL = await page.evaluate(() => {
      const c = document.createElement("canvas");
      return !!(c.getContext("webgl2") || c.getContext("webgl"));
    });
    if (temGL) {
      await expect(viewer).toHaveAttribute("data-modo", "3d", { timeout: 15_000 });
      await expect(viewer.locator("canvas")).toHaveCount(1);
    } else {
      await expect(viewer.getByTestId("mascote-svg")).toBeVisible();
    }
  });

  test("/bem-vindo: o passo final monta o bicho e o fim mostra comunidades", async ({ memberPage: page }) => {
    await limpar();
    await page.goto("/bem-vindo?refazer=1");
    await page.getByRole("button", { name: "participar de hackathon" }).click();
    await page.getByTestId("onboarding-continue").click();
    await page.getByLabel(/cidade/i).fill("Sorocaba, SP");
    await page.getByTestId("onboarding-continue").click();
    await page.getByTestId("onboarding-continue").click();
    const passo = page.getByTestId("onboarding-bicho");
    await expect(passo).toBeVisible();
    await expect(passo.getByRole("heading", { name: "Monte seu bicho" })).toBeVisible();
    await page.getByTestId("mascote-op-especie-servidor").click();
    await page.getByTestId("mascote-nome").fill("Rack");
    await page.getByTestId("mascote-salvar").click();
    await expect(page.getByTestId("onboarding-done")).toBeVisible();
    expect(await salvo()).toMatchObject({ especie: "servidor", nome: "Rack" });
  });

  test("390px sem scroll horizontal em /perfil, /perfil/bicho e no passo do bicho", async ({ memberPage: page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/perfil");
    await expect(page.getByTestId("perfil-bicho")).toBeVisible();
    await noHorizontalScroll(page, "/perfil");
    await page.goto("/perfil/bicho");
    await expect(page.getByTestId("mascote-editor")).toBeVisible();
    for (const aba of ["especie", "cores", "cenario"]) {
      await page.getByTestId(`mascote-aba-${aba}`).click();
      await noHorizontalScroll(page, `/perfil/bicho (${aba})`);
    }
    // a barra de abas rola por dentro
    const abas = page.getByRole("tablist", { name: "partes do bicho" });
    const { sw, cw } = await abas.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }));
    expect(sw).toBeGreaterThan(cw);
    await shot(page, "bicho-criador-390");
    await page.goto("/bem-vindo?refazer=1");
    await page.getByRole("button", { name: "pular por agora" }).isVisible();
    await page.getByTestId("onboarding-continue").click();
    await page.getByTestId("onboarding-continue").click();
    await page.getByTestId("onboarding-continue").click();
    await expect(page.getByTestId("onboarding-bicho")).toBeVisible();
    await noHorizontalScroll(page, "/bem-vindo (bicho)");
    await page.getByTestId("onboarding-bicho-pular").click();
    await expect(page.getByTestId("onboarding-done")).toBeVisible();
    await noHorizontalScroll(page, "/bem-vindo (fim)");
    const eu = await me();
    await page.goto(`/u/${eu.username}`);
    await expect(page.getByTestId("u-bicho")).toBeVisible();
    await noHorizontalScroll(page, "/u");
  });
});
