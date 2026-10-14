import { expect, type Page } from "@playwright/test";
import path from "node:path";
import { E2E_MEMBER_EMAIL, test } from "./auth";
import { openE2eDb } from "./db";

// auditoria 041 pacote E — páginas públicas e do participante sem contraste
// reprovado nem link que só se distingue pela cor, /perfil com username de
// 20 caracteres a 390px, "Contato com marcas" com revogar, e a aba de
// avisos sem prometer e-mail quando o e-mail está desligado (o e2e roda sem
// RESEND_API_KEY, como prod hoje).

const SHOTS = process.env.SHOTS_DIR ?? "test-results/pkg-e";
const AXE = path.join(process.cwd(), "node_modules", "axe-core", "axe.min.js");
const ED = "e2e-e-marcas";
const db = openE2eDb();

async function axeIds(page: Page, rules: string[]) {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async (only) => {
    const axe = (window as unknown as { axe: { run: (o: unknown) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } }).axe;
    const r = await axe.run({ runOnly: { type: "rule", values: only } });
    return r.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
  }, rules);
}

async function at390(page: Page, shot: string) {
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await page.screenshot({ path: `${SHOTS}/${shot}.png`, fullPage: true });
  expect(overflow, `${shot}: scroll horizontal a 390px`).toBeLessThanOrEqual(0);
}

async function me(): Promise<{ id: number; username: string }> {
  return (await db
    .prepare("SELECT id, username FROM members WHERE email = ?")
    .get<{ id: number; username: string }>(E2E_MEMBER_EMAIL))!;
}

test.describe("pacote E — contraste, links e 390px", () => {
  for (const [route, shot] of [
    ["/feed", "feed"],
    ["/empresas", "empresas"],
    ["/legal/privacidade", "legal-privacidade"],
    ["/legal/termos", "legal-termos"],
    ["/talento", "talento"],
  ] as const) {
    test(`${route} sem color-contrast nem link-in-text-block`, async ({ memberPage: page }) => {
      const res = await page.goto(route);
      expect(res?.status()).toBe(200);
      expect(await axeIds(page, ["color-contrast", "link-in-text-block"])).toEqual([]);
      await at390(page, shot);
    });
  }

  test("/legal/privacidade lista operadores, patrocinador e versão", async ({ page }) => {
    await page.goto("/legal/privacidade");
    const ops = page.getByTestId("operadores");
    for (const op of ["Clerk", "Oracle Cloud", "Resend"]) await expect(ops).toContainText(op);
    await expect(page.getByText(/WhatsApp/).first()).toBeVisible();
    await expect(page.locator("#patrocinador")).toContainText(/autoriza/);
    await expect(page.getByTestId("privacy-version")).toContainText(/versão \d/);
    await page.goto("/legal/termos");
    await expect(page.getByTestId("terms-version")).toContainText(/versão \d/);
  });

  test("/radar não mostra tag de prêmio nem pedaço de tema em inglês", async ({ page }) => {
    await page.goto("/radar");
    await expect(page.getByText(/#premio-/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^#(low|open|machine)$/ })).toHaveCount(0);
  });
});

test.describe("pacote E — /perfil", () => {
  test("username de 20 caracteres não estoura 390px e o contato com marca é revogável", async ({
    memberPage: page,
  }) => {
    const m = await me();
    const long = "auditacessibilidade1";
    // a edição e a marca do teste, com o membro aprovado e o contato compartilhado
    await db
      .prepare(
        `INSERT INTO hackathons (id, name, organizer, startsAt, format, registrationUrl, tags, active, source)
         VALUES (?, 'E2E E Marcas', 'Hack Inova E2E', '2027-03-01', 'presencial', 'https://e2e.dev/e', '[]', 1, 'e2e')
         ON CONFLICT(id) DO NOTHING`,
      )
      .run(ED);
    await db.prepare("INSERT INTO sponsors (id, name) VALUES ('e2e-e-marca', 'Marca Pacote E') ON CONFLICT DO NOTHING").run();
    await db
      .prepare("INSERT INTO edition_sponsors (hackathonId, sponsorId) VALUES (?, 'e2e-e-marca') ON CONFLICT DO NOTHING")
      .run(ED);
    await db
      .prepare("INSERT OR IGNORE INTO registrations (memberId, hackathonId, status) VALUES (?, ?, 'approved')")
      .run(m.id, ED);
    await db
      .prepare(
        `INSERT INTO sponsor_contact_optins (hackathonId, sponsorId, memberId) VALUES (?, 'e2e-e-marca', ?)
         ON CONFLICT (hackathonId, sponsorId, memberId) DO UPDATE SET revokedAt = NULL`,
      )
      .run(ED, m.id);
    await db.prepare("UPDATE members SET username = ? WHERE id = ?").run(long, m.id);
    try {
      await page.goto("/perfil");
      await expect(page.getByRole("heading", { level: 1 })).toContainText(`@${long}`);
      const marcas = page.getByTestId("contact-shares");
      await expect(marcas).toContainText("Marca Pacote E");
      await at390(page, "perfil-390");
      expect(await axeIds(page, ["color-contrast", "link-in-text-block"])).toEqual([]);
      // sem RESEND no e2e: o perfil não promete e-mail
      await expect(page.getByText(/no seu e-mail/)).toHaveCount(0);
      await marcas.getByRole("button", { name: /revogar o compartilhamento com Marca Pacote E/ }).click();
      await expect(marcas.getByRole("status")).toContainText(/revogado/);
      const row = await db
        .prepare("SELECT revokedAt FROM sponsor_contact_optins WHERE hackathonId = ? AND memberId = ?")
        .get<{ revokedAt: string | null }>(ED, m.id);
      expect(row?.revokedAt).toBeTruthy();
    } finally {
      await db.prepare("UPDATE members SET username = ? WHERE id = ?").run(m.username, m.id);
    }
  });
});

test.describe("pacote E — avisos com e-mail desligado", () => {
  test("a aba avisa que e-mail e WhatsApp estão desligados e o composer só promete página e sino", async ({
    memberPage: page,
  }) => {
    const m = await me();
    await db
      .prepare(
        `INSERT INTO hackathons (id, name, organizer, startsAt, format, registrationUrl, tags, active, source)
         VALUES (?, 'E2E E Marcas', 'Hack Inova E2E', '2027-03-01', 'presencial', 'https://e2e.dev/e', '[]', 1, 'e2e')
         ON CONFLICT(id) DO NOTHING`,
      )
      .run(ED);
    await db
      .prepare("INSERT OR IGNORE INTO edition_roles (hackathonId, memberId, role) VALUES (?, ?, 'organizador')")
      .run(ED, m.id);
    await page.goto(`/admin/h/${ED}/avisos`);
    await expect(page.getByTestId("channels-off")).toContainText(/E-mail e WhatsApp ainda não estão ligados/);
    await expect(page.getByText("O texto aparece na página da edição e no sino.")).toBeVisible();
    await expect(page.getByText(/Sem grupo/)).toHaveCount(0);
    await at390(page, "avisos-390");
  });
});
