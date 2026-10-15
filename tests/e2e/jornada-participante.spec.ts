import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { E2E_MEMBER_EMAIL, test } from "./auth";
import { openE2eDb } from "./db";

// Auditoria 041, pacote C (jornada do participante): cancelar a inscrição
// pede confirmação; quem está na fila vê a posição em /ingresso; /inscricao
// mostra os próximos passos; "Meu time" tem remover (quem está sem inscrição), sair e um link só pra
// entrega. Tudo a 390px sem scroll horizontal.

const ED = "e2e-jornada-c";
const SHOTS = process.env.E2E_SHOT_DIR;

async function noHorizontalScroll(page: Page) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(sw, "scroll horizontal").toBeLessThanOrEqual(iw);
}

async function shot(page: Page, name: string) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
}

/** edição futura com 1 vaga; `me` = membro logado do e2e */
async function seed(request: APIRequestContext) {
  await request.get("/api/health");
  const db = openE2eDb();
  const start = new Date(Date.now() + 10 * 86_400_000).toISOString();
  await db
    .prepare(
      `INSERT INTO hackathons (id, name, organizer, startsAt, endsAt, format, location, registrationUrl, tags,
         active, source, requiresApproval, capacity, publishedAt)
       VALUES (?, 'E2E Jornada do Participante', 'Hack Inova E2E', ?, NULL, 'presencial', 'Campus E2E',
               '/h/e2e-jornada-c', '[]', 1, 'painel', 0, 1, sqlite_now())
       ON CONFLICT (id) DO UPDATE SET startsAt = excluded.startsAt, active = 1, capacity = 1, requiresApproval = 0`,
    )
    .run(ED, start);
  const me = await db.prepare("SELECT id, username FROM members WHERE email = ?").get<{ id: number; username: string }>(
    E2E_MEMBER_EMAIL,
  );
  if (!me) throw new Error("membro de teste não existe no banco do e2e");
  for (const u of ["jc_vaga", "jc_fila", "jc_colega", "jc_firme"]) {
    await db
      .prepare("INSERT INTO members (clerkId, username, email, name) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING")
      .run(`clerk_${u}`, u, `${u}@e2e.dev`, u);
  }
  await db.prepare("DELETE FROM team_invites WHERE hackathonId = ?").run(ED);
  await db.prepare("DELETE FROM team_members WHERE teamId IN (SELECT id FROM teams WHERE hackathonId = ?)").run(ED);
  await db.prepare("DELETE FROM teams WHERE hackathonId = ?").run(ED);
  await db.prepare("DELETE FROM registrations WHERE hackathonId = ?").run(ED);
  return { db, me };
}

const reg = (db: ReturnType<typeof openE2eDb>, username: string, status: string, minutesAgo = 0) =>
  db
    .prepare(
      `INSERT INTO registrations (memberId, hackathonId, status, waitlistedAt)
       SELECT id, ?, ?, CASE WHEN ?::text = 'waitlist' THEN to_char(now() - make_interval(mins => ?::int), 'YYYY-MM-DD HH24:MI:SS') END
       FROM members WHERE username = ?`,
    )
    .run(ED, status, status, minutesAgo, username);

test.describe.configure({ mode: "serial" });

test.describe("jornada do participante", () => {
  test("quem está na fila vê 'fila de espera #N' no ingresso", async ({ memberPage: page, request }) => {
    const { db, me } = await seed(request);
    await reg(db, "jc_vaga", "approved");
    await reg(db, "jc_fila", "waitlist", 10);
    await reg(db, me.username, "waitlist", 1);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/h/${ED}/ingresso`);
    await expect(page.getByTestId("ticket-waitlist")).toContainText("fila de espera #2");
    await expect(page.getByText("Você não está inscrito")).toHaveCount(0);
    await noHorizontalScroll(page);
    await shot(page, "ingresso-fila-390");
  });

  test("cancelar a inscrição pede confirmação e só cancela com o ok", async ({ memberPage: page, request }) => {
    const { db, me } = await seed(request);
    await reg(db, me.username, "approved");
    await reg(db, "jc_fila", "waitlist", 10);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/h/${ED}`);
    await expect(page.getByTestId("registration-status")).toContainText("você está inscrito");
    await noHorizontalScroll(page);
    await shot(page, "edicao-inscrito-390");

    const cancel = page.getByRole("button", { name: "cancelar inscrição" });
    let asked = "";
    page.once("dialog", (d) => {
      asked = d.message();
      void d.dismiss();
    });
    await cancel.click();
    await expect.poll(() => asked).toContain("Sua vaga vai pra próxima pessoa da fila");
    const status = async (u: string) =>
      (
        await db
          .prepare("SELECT r.status FROM registrations r JOIN members m ON m.id = r.memberId WHERE r.hackathonId = ? AND m.username = ?")
          .get<{ status: string }>(ED, u)
      )?.status ?? null;
    expect(await status(me.username)).toBe("approved");

    page.once("dialog", (d) => void d.accept());
    await cancel.click();
    await expect.poll(() => status(me.username)).toBeNull();
    expect(await status("jc_fila")).toBe("approved"); // a vaga foi pra fila
  });

  test("/inscricao de quem está aprovado mostra os próximos passos", async ({ memberPage: page, request }) => {
    const { db, me } = await seed(request);
    await reg(db, me.username, "approved");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/h/${ED}/inscricao`);
    const steps = page.getByRole("navigation", { name: "próximos passos" });
    await expect(steps.getByRole("link", { name: /meu ingresso/ })).toHaveAttribute("href", `/h/${ED}/ingresso`);
    await expect(steps.getByRole("link", { name: /time/ })).toBeVisible();
    await expect(steps.getByRole("link", { name: /dúvidas/ })).toBeVisible();
    await noHorizontalScroll(page);
    await shot(page, "inscricao-aprovado-390");
  });

  test("meu time: link fixo pra entrega, remover colega sem inscrição e sair", async ({ memberPage: page, request }) => {
    const { db, me } = await seed(request);
    await db.prepare("UPDATE hackathons SET capacity = NULL WHERE id = ?").run(ED);
    await reg(db, me.username, "approved");
    await reg(db, "jc_firme", "approved");
    // jc_colega ficou no time sem inscrição aprovada (dado antigo)
    const t = await db
      .prepare("INSERT INTO teams (hackathonId, name, placement) VALUES (?, 'Time Jornada', 0) RETURNING id")
      .get<{ id: number }>(ED);
    for (const u of [me.username, "jc_colega", "jc_firme"]) {
      await db.prepare("INSERT INTO team_members (teamId, username) VALUES (?, ?)").run(t!.id, u);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/h/${ED}#meu-time`);
    const panel = page.getByTestId("my-team");
    await expect(panel.getByTestId("open-entry")).toHaveAttribute("href", `/h/${ED}/entrega`);
    await expect(panel.getByRole("button", { name: "remover @jc_colega do time" })).toBeVisible();
    await expect(panel.getByRole("button", { name: `remover @${me.username} do time` })).toHaveCount(0);
    // aprovado só sai por conta própria ou pela organização
    await expect(panel.getByRole("button", { name: "remover @jc_firme do time" })).toHaveCount(0);
    await noHorizontalScroll(page);
    await panel.scrollIntoViewIfNeeded();
    await shot(page, "meu-time-390");

    page.once("dialog", (d) => void d.accept());
    await panel.getByRole("button", { name: "remover @jc_colega do time" }).click();
    await expect(panel.getByRole("status")).toContainText("@jc_colega saiu do time");

    page.once("dialog", (d) => void d.accept());
    await panel.getByRole("button", { name: "sair do time" }).click();
    await expect(panel.getByRole("button", { name: "criar time" })).toBeVisible();
  });

  test("entrega e procuro time a 390px", async ({ memberPage: page, request }) => {
    const { db, me } = await seed(request);
    await reg(db, me.username, "approved");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/h/${ED}/entrega`);
    await expect(page.getByText("Você ainda não tem time nesta edição.")).toBeVisible();
    await noHorizontalScroll(page);
    await shot(page, "entrega-sem-time-390");

    const t = await db
      .prepare("INSERT INTO teams (hackathonId, name, placement) VALUES (?, 'Time Entrega', 0) RETURNING id")
      .get<{ id: number }>(ED);
    await db.prepare("INSERT INTO team_members (teamId, username) VALUES (?, ?)").run(t!.id, me.username);
    await page.goto(`/h/${ED}/entrega`);
    await expect(page.getByText("preencha o título pra começar a salvar o rascunho")).toBeVisible();
    await expect(page.getByRole("button", { name: /enviar versão 1/ })).toBeDisabled();
    await noHorizontalScroll(page);
    await shot(page, "entrega-390");

    await db.prepare("DELETE FROM team_members WHERE teamId = ?").run(t!.id);
    await page.goto(`/h/${ED}`);
    await page.getByRole("button", { name: "+ procuro time" }).click();
    await expect(page.getByText("Não coloque telefone nem e-mail")).toBeVisible();
    await noHorizontalScroll(page);
    await shot(page, "procuro-time-390");
  });
});
