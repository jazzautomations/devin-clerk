import { expect } from "@playwright/test";
import { E2E_MEMBER_EMAIL, test } from "./auth";
import { openE2eDb } from "./db";
import { ACESSORIOS, ESPECIES, ESTAGIOS } from "@/lib/mascote/tipos";

// Grade de revisão do bicho (migration 043): /admin/bichos é só do admin
// global. "Ficar bonito" não é coisa que teste confere: este arquivo tira
// screenshot de cada seção da grade e anexa ao relatório (e em
// E2E_SHOT_DIR, se existir) pra uma pessoa olhar antes do merge.
// O membro de teste vira admin só durante este arquivo.

const SHOTS = process.env.E2E_SHOT_DIR;

async function setRole(role: "admin" | "member") {
  await openE2eDb().prepare("UPDATE members SET role = ? WHERE email = ?").run(role, E2E_MEMBER_EMAIL);
}

test.describe.configure({ mode: "serial" });

test.describe("grade dos bichos", () => {
  test.beforeAll(async ({ request }) => {
    await request.get("/api/health");
  });
  test.afterAll(async () => {
    await setRole("member");
  });

  test("membro comum não vê a grade", async ({ memberPage: page }) => {
    await setRole("member");
    const res = await page.goto("/admin/bichos");
    expect(res?.status()).toBe(404);
    await expect(page.getByTestId("bichos-grade")).toHaveCount(0);
  });

  test("admin vê espécie x acessório x estágio e os encaixes marcados", async ({ memberPage: page }, info) => {
    await setRole("admin");
    await page.goto("/admin/bichos");
    const grade = page.getByTestId("bichos-grade");
    await expect(grade).toBeVisible();
    // linha dos encaixes: um bicho por espécie, com as 5 marcas
    await expect(page.getByTestId("bichos-encaixes").locator("img")).toHaveCount(ESPECIES.length);
    for (const e of ESPECIES) {
      await expect(page.getByTestId(`bichos-especie-${e}`).locator("img")).toHaveCount(ACESSORIOS.length * ESTAGIOS.length);
    }
    // toda imagem é SVG em data URI e carregou
    const quebradas = await grade.locator("img").evaluateAll((imgs) =>
      imgs.filter((i) => !(i as HTMLImageElement).src.startsWith("data:image/svg+xml") || !(i as HTMLImageElement).naturalWidth).length,
    );
    expect(quebradas).toBe(0);
    const shot = await page.screenshot({ fullPage: true, ...(SHOTS ? { path: `${SHOTS}/bichos-grade-base.png` } : {}) });
    await info.attach("grade-base", { body: shot, contentType: "image/png" });
  });

  for (const secao of ["topo", "roupa", "mao", "rosto", "cenario"]) {
    test(`admin: seção ${secao} da grade`, async ({ memberPage: page }, info) => {
      await setRole("admin");
      await page.goto(`/admin/bichos?secao=${secao}`);
      await expect(page.getByTestId("bichos-grade")).toBeVisible();
      await expect(page.getByRole("navigation", { name: "seções da grade" }).locator('[aria-current="page"]')).toHaveCount(1);
      expect(await page.getByTestId("bichos-grade").locator("img").count()).toBeGreaterThanOrEqual(ESPECIES.length * 4);
      const shot = await page.screenshot({ fullPage: true, ...(SHOTS ? { path: `${SHOTS}/bichos-grade-${secao}.png` } : {}) });
      await info.attach(`grade-${secao}`, { body: shot, contentType: "image/png" });
    });
  }

  test("390px: a grade rola por dentro das linhas, sem scroll na página", async ({ memberPage: page }) => {
    await setRole("admin");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/admin/bichos");
    await expect(page.getByTestId("bichos-grade")).toBeVisible();
    const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    expect(sw, "scroll horizontal").toBeLessThanOrEqual(iw);
  });
});
