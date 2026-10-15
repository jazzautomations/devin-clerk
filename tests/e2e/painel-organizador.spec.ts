import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { E2E_MEMBER_EMAIL, test } from "./auth";
import { openE2eDb } from "./db";

// Auditoria 041, pacote B: o organizador convidado (sem admin global) opera
// a própria edição. Edita a data na aba configurar (gravada no horário de
// Brasília), publica o rascunho, aprova o pedido pendente na aba inscritos e
// vê a aba ativa marcada. No check-in a 390px, Enter em "marcar presença"
// limpa a busca e devolve o foco pra ela, com o aviso à vista.

const ED = "e2e-painel-org";
const SHOTS = process.env.E2E_SHOT_DIR;

const pad = (n: number) => String(n).padStart(2, "0");
/** amanhã às 18:00 no relógio de Brasília (sem horário de verão desde 2019) */
function tomorrowBrt18() {
  const d = new Date(Date.now() - 3 * 3_600_000 + 86_400_000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T18:00`;
}

async function seed(request: APIRequestContext) {
  await request.get("/api/health");
  const db = openE2eDb();
  // a edição acontece agora: a janela do check-in está aberta
  const start = new Date(Date.now() - 3_600_000).toISOString();
  await db
    .prepare(
      `INSERT INTO hackathons (id, name, organizer, startsAt, endsAt, format, location, registrationUrl, tags,
         active, source, requiresApproval, capacity)
       VALUES (?, 'E2E Painel do Organizador', 'Hack Inova E2E', ?, NULL, 'presencial', 'Campus E2E',
               '/h/e2e-painel-org', '[]', 0, 'painel', 1, NULL)
       ON CONFLICT (id) DO UPDATE SET startsAt = excluded.startsAt, endsAt = NULL, active = 0, publishedAt = NULL,
         requiresApproval = 1, location = excluded.location`,
    )
    .run(ED, start);
  const me = await db.prepare("SELECT id FROM members WHERE email = ?").get<{ id: number }>(E2E_MEMBER_EMAIL);
  if (!me) throw new Error("membro de teste não existe no banco do e2e");
  await db
    .prepare("INSERT INTO edition_roles (hackathonId, memberId, role) VALUES (?, ?, 'organizador') ON CONFLICT DO NOTHING")
    .run(ED, me.id);
  const people: [string, string, string][] = [
    ["clerk_e2e_pendente", "pendente_e2e", "Paula Pendente"],
    ["clerk_e2e_porta", "porta_e2e", "Zeca Porta"],
    ["clerk_e2e_porta2", "porta2_e2e", "Zeca Portinha"],
  ];
  for (const [c, u, n] of people) {
    await db
      .prepare("INSERT INTO members (clerkId, username, email, name) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING")
      .run(c, u, `${u}@e2e.dev`, n);
  }
  await db.prepare("DELETE FROM checkins WHERE registrationId IN (SELECT id FROM registrations WHERE hackathonId = ?)").run(ED);
  await db.prepare("DELETE FROM registrations WHERE hackathonId = ?").run(ED);
  const reg = (u: string, status: string) =>
    db
      .prepare(
        `INSERT INTO registrations (memberId, hackathonId, status)
         SELECT id, ?, ? FROM members WHERE username = ?`,
      )
      .run(ED, status, u);
  await reg("pendente_e2e", "pending");
  await reg("porta_e2e", "approved");
  await reg("porta2_e2e", "approved");
}

async function noHorizontalScroll(page: Page) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(sw, "scroll horizontal").toBeLessThanOrEqual(iw);
}

test.describe.configure({ mode: "serial" });

test.describe("painel do organizador (sem admin global)", () => {
  test.beforeAll(async ({ request }) => {
    await seed(request);
  });

  test("edita a data em horário de Brasília, publica e vê a aba ativa", async ({ memberPage: page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/admin/h/${ED}`);
    const tabs = page.getByTestId("admin-tabs");
    await expect(tabs.getByRole("link", { name: "visão geral" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByTestId("ov-phase")).toHaveText(/rascunho/);
    await expect(page.getByTestId("ov-checklist")).toBeVisible();
    await expect(page.getByTestId("draft-note")).toBeVisible();
    await noHorizontalScroll(page);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/painel-visao-geral-390.png`, fullPage: true });

    await tabs.getByRole("link", { name: "configurar" }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/h/${ED}/edicao$`));
    await expect(page.getByTestId("admin-tabs").getByRole("link", { name: "configurar" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    // organizador não arquiva nem troca o link externo: só o admin
    await expect(page.getByText("no ar (desmarcar arquiva a edição)")).toHaveCount(0);
    const end = tomorrowBrt18();
    await page.getByLabel("fim (opcional, horário de Brasília)").fill(end);
    await page.getByRole("button", { name: "salvar edição →" }).click();
    await expect(page.getByRole("status").filter({ hasText: "salvo" })).toBeVisible();
    const db = openE2eDb();
    const row = await db.prepare("SELECT endsAt, active FROM hackathons WHERE id = ?").get<{ endsAt: string; active: number }>(ED);
    expect(row).toEqual({ endsAt: `${end}:00-03:00`, active: 0 });
    // recarregar e salvar de novo sem mexer não muda a data
    await page.reload();
    await expect(page.getByLabel("fim (opcional, horário de Brasília)")).toHaveValue(end);
    await page.getByRole("button", { name: "salvar edição →" }).click();
    await expect(page.getByRole("status").filter({ hasText: "salvo" })).toBeVisible();
    expect((await db.prepare("SELECT endsAt FROM hackathons WHERE id = ?").get<{ endsAt: string }>(ED))!.endsAt).toBe(
      `${end}:00-03:00`,
    );
    await noHorizontalScroll(page);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/painel-configurar-390.png`, fullPage: true });

    await page.getByRole("button", { name: "publicar edição" }).click();
    await expect(page.getByTestId("draft-note")).toHaveCount(0);
    expect((await db.prepare("SELECT active FROM hackathons WHERE id = ?").get<{ active: number }>(ED))!.active).toBe(1);
  });

  test("aprova o pedido pendente na aba inscritos", async ({ memberPage: page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/admin/h/${ED}`);
    await page.getByTestId("ov-pending").getByRole("link").click();
    await expect(page).toHaveURL(new RegExp(`/admin/h/${ED}/inscritos\\?status=pending$`));
    await expect(page.getByTestId("registrant-row")).toHaveCount(1);
    await noHorizontalScroll(page);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/painel-inscritos-390.png`, fullPage: true });
    await page.getByRole("button", { name: "aprovar Paula Pendente" }).click();
    // aprovada, sai do filtro de pendentes
    await expect(page.getByTestId("registrant-row")).toHaveCount(0);
    const db = openE2eDb();
    await expect
      .poll(async () =>
        (
          await db
            .prepare(
              "SELECT r.status FROM registrations r JOIN members m ON m.id = r.memberId WHERE m.username = 'pendente_e2e' AND r.hackathonId = ?",
            )
            .get<{ status: string }>(ED)
        )?.status,
      )
      .toBe("approved");
  });

  test("check-in a 390px: Enter marca presença e devolve o foco pra busca", async ({ memberPage: page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/admin/h/${ED}/checkin`);
    await expect(page.getByTestId("checkin-window-note")).toHaveCount(0);
    const search = page.getByLabel("busca manual: nome, e-mail ou username");
    await search.fill("zeca");
    const results = page.getByTestId("checkin-results");
    await expect(results.getByRole("button", { name: "marcar presença" })).toHaveCount(2);
    // a ação principal vem antes do reenvio: Tab a partir da busca cai nela
    await search.focus();
    await page.keyboard.press("Tab");
    await expect(page.locator(":focus")).toHaveText("marcar presença");
    await page.keyboard.press("Enter");
    const feedback = page.getByTestId("checkin-feedback");
    await expect(feedback).toContainText("Zeca");
    await expect(search).toBeFocused();
    await expect(search).toHaveValue("");
    await expect(feedback).toBeInViewport();
    await expect(search).toBeInViewport();
    await noHorizontalScroll(page);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/checkin-depois-390.png` });
    const db = openE2eDb();
    const n = await db
      .prepare(
        "SELECT COUNT(*)::int AS n FROM checkins c JOIN registrations r ON r.id = c.registrationId WHERE r.hackathonId = ?",
      )
      .get<{ n: number }>(ED);
    expect(n!.n).toBe(1);
  });

  test("edição arquivada pelo admin: o organizador não vê o botão de publicar e a API recusa", async ({
    memberPage: page,
  }) => {
    const db = openE2eDb();
    // o admin global arquivou (a edição já tinha ido ao ar no primeiro teste)
    await db.prepare("UPDATE hackathons SET active = 0 WHERE id = ?").run(ED);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/admin/h/${ED}`);
    await expect(page.getByTestId("ov-phase")).toHaveText(/arquivada/);
    await expect(page.getByTestId("draft-note")).toContainText("arquivada");
    await expect(page.getByRole("button", { name: "publicar edição" })).toHaveCount(0);
    await page.goto(`/admin/h/${ED}/edicao`);
    await expect(page.getByTestId("edition-archived")).toBeVisible();
    await expect(page.getByRole("button", { name: "publicar edição" })).toHaveCount(0);
    await noHorizontalScroll(page);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/painel-arquivada-390.png`, fullPage: true });
    const res = await page.request.patch(`/api/admin/hackathons/${ED}`, { data: { active: true } });
    expect(res.status()).toBe(403);
    expect((await db.prepare("SELECT active FROM hackathons WHERE id = ?").get<{ active: number }>(ED))!.active).toBe(0);
  });
});
