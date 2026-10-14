import { expect, type Page } from "@playwright/test";
import path from "node:path";
import { E2E_MEMBER_EMAIL, test } from "./auth";
import { openE2eDb } from "./db";

// Auditoria 041, pacote D: júri, palco, certificados e pós-evento, olhados
// logado com o membro de teste. Cobre:
// - /h/[id]/votar e /admin/h/[id]/juri sem violação séria do axe e com
//   radios nativos (setas trocam a nota);
// - publicar com avaliação faltando mostra quantas notas faltam;
// - certificado revogado diz "revogado" e some o PDF;
// - aba certificados avisa o papel sem horas;
// - 390px sem scroll horizontal nas telas mexidas (prints em SHOTS_DIR).

const STAGE = "e2e-d-palco";
const JURY = "e2e-d-juri";
const REVOKED = "E2ED0REV42";
const SHOTS = process.env.SHOTS_DIR ?? "test-results/pkg-d";
const AXE = path.join(process.cwd(), "node_modules", "axe-core", "axe.min.js");

const db = openE2eDb();
let me = 0;
let stageA = 0;
let juryA = 0;

async function edition(id: string, name: string, startsAt: string, endsAt: string | null) {
  await db
    .prepare(
      `INSERT INTO hackathons
         (id, name, organizer, startsAt, endsAt, format, location, registrationUrl, tags, active, source)
       VALUES (?, ?, 'Hack Inova E2E', ?, ?, 'presencial', 'São Paulo', 'https://e2e.dev/d', '[]', 1, 'e2e')
       ON CONFLICT(id) DO UPDATE SET startsAt = EXCLUDED.startsAt, endsAt = EXCLUDED.endsAt, active = 1`,
    )
    .run(id, name, startsAt, endsAt);
}

async function team(hackathonId: string, name: string, title: string, members: string[] = []): Promise<number> {
  const existing = await db
    .prepare("SELECT id FROM teams WHERE hackathonId = ? AND name = ?")
    .get<{ id: number }>(hackathonId, name);
  const id =
    existing?.id ??
    (await db
      .prepare("INSERT INTO teams (hackathonId, name, placement) VALUES (?, ?, 0) RETURNING id")
      .get<{ id: number }>(hackathonId, name))!.id;
  await db
    .prepare("INSERT OR REPLACE INTO team_projects (teamId, title, description) VALUES (?, ?, 'projeto de e2e')")
    .run(id, title);
  for (const u of members) await db.prepare("INSERT OR IGNORE INTO team_members (teamId, username) VALUES (?, ?)").run(id, u);
  return id;
}

async function seed(page: Page) {
  // o membro de teste nasce no global-setup; garante o init do server
  await page.request.get("/api/health");
  me = (await db.prepare("SELECT id FROM members WHERE email = ?").get<{ id: number }>(E2E_MEMBER_EMAIL))!.id;
  const hourAgo = new Date(Date.now() - 3600_000).toISOString();

  // palco ao vivo com o membro credenciado
  await edition(STAGE, "E2E D Final", hourAgo, null);
  for (const t of ["live_votes", "stage_queue", "stage_sessions"]) {
    await db.prepare(`DELETE FROM ${t} WHERE hackathonId = ?`).run(STAGE);
  }
  stageA = await team(STAGE, "Time Delta", "Projeto Delta");
  const stageB = await team(STAGE, "Time Eco", "Projeto Eco");
  for (const [i, id] of [stageA, stageB].entries()) {
    await db.prepare("INSERT INTO stage_queue (hackathonId, teamId, position) VALUES (?, ?, ?)").run(STAGE, id, i + 1);
  }
  await db
    .prepare(
      `INSERT INTO stage_sessions (hackathonId, status, currentTeamId, pitchSeconds, votingOpen)
       VALUES (?, 'live', ?, 180, 1)`,
    )
    .run(STAGE, stageA);
  await db
    .prepare("INSERT OR IGNORE INTO registrations (memberId, hackathonId, status) VALUES (?, ?, 'approved')")
    .run(me, STAGE);
  await db
    .prepare(
      `INSERT OR IGNORE INTO checkins (registrationId)
       SELECT id FROM registrations WHERE memberId = ? AND hackathonId = ?`,
    )
    .run(me, STAGE);
  await db
    .prepare("INSERT OR IGNORE INTO edition_roles (hackathonId, memberId, role) VALUES (?, ?, 'organizador')")
    .run(STAGE, me);

  // júri: o membro organiza e também é jurado; edição já encerrada
  await edition(JURY, "E2E D Júri", "2026-01-10 12:00:00", "2026-01-11 21:00:00");
  for (const r of ["organizador", "jurado"]) {
    await db.prepare("INSERT OR IGNORE INTO edition_roles (hackathonId, memberId, role) VALUES (?, ?, ?)").run(JURY, me, r);
  }
  await db.prepare("DELETE FROM jury_results WHERE hackathonId = ?").run(JURY);
  await db.prepare("DELETE FROM certificate_settings WHERE hackathonId = ?").run(JURY);
  juryA = await team(JURY, "Time Foxtrot", "Projeto Foxtrot com um nome comprido pra testar quebra de linha");
  const juryB = await team(JURY, "Time Golf", "Projeto Golf");
  let crit = await db.prepare("SELECT id FROM rubric_criteria WHERE hackathonId = ? ORDER BY id").all<{ id: number }>(JURY);
  if (crit.length === 0) {
    for (const [label, w] of [["Impacto", 2], ["Execução", 1]] as const) {
      await db.prepare("INSERT INTO rubric_criteria (hackathonId, label, weight) VALUES (?, ?, ?)").run(JURY, label, w);
    }
    crit = await db.prepare("SELECT id FROM rubric_criteria WHERE hackathonId = ? ORDER BY id").all<{ id: number }>(JURY);
  }
  for (const t of [juryA, juryB]) {
    await db
      .prepare("INSERT OR IGNORE INTO judge_assignments (hackathonId, judgeMemberId, teamId) VALUES (?, ?, ?)")
      .run(JURY, me, t);
  }
  await db.prepare("DELETE FROM scores WHERE judgeMemberId = ? AND teamId IN (?, ?)").run(me, juryA, juryB);
  // time A avaliado só num critério: avaliação incompleta
  await db
    .prepare("INSERT INTO scores (judgeMemberId, teamId, criterionId, score) VALUES (?, ?, ?, 5)")
    .run(me, juryA, crit[0].id);

  // certificado revogado (pódio republicado)
  await db
    .prepare(
      `INSERT INTO certificates (code, memberId, hackathonId, kind, detail, issuedAt, revokedAt)
       VALUES (?, ?, ?, 'premiacao', '2º lugar com o time Golf', '2026-01-12 10:00:00', '2026-01-13 10:00:00')
       ON CONFLICT (code) DO NOTHING`,
    )
    .run(REVOKED, me, JURY);
}

async function axeSerious(page: Page) {
  await page.addScriptTag({ path: AXE });
  const result = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run: (o: unknown) => Promise<{ violations: { id: string; impact: string; nodes: { target: string[] }[] }[] }> } }).axe;
    const r = await axe.run({ runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] } });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.slice(0, 3).map((n) => n.target.join(" ")) }));
  });
  return result.filter((v) => v.impact === "serious" || v.impact === "critical");
}

async function noHorizontalScroll(page: Page, shot: string) {
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await page.screenshot({ path: `${SHOTS}/${shot}.png`, fullPage: true });
  expect(overflow).toBeLessThanOrEqual(0);
}

test.describe("pacote D — júri, palco e certificados logado", () => {
  test.beforeEach(async ({ memberPage }) => {
    await seed(memberPage);
  });

  test("/h/[id]/votar: h1, radios nativos com setas, status sempre montado e axe sem violação séria", async ({ memberPage: page }) => {
    await page.goto(`/h/${STAGE}/votar`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("E2E D Final");
    await expect(page.getByTestId("stage-vote-status")).toBeAttached();
    const r1 = page.getByRole("radio", { name: /nota 1/ });
    await r1.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("radio", { name: /nota 2/ })).toBeChecked();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("radio", { name: /nota 3/ })).toBeChecked();
    // o voto sai uma vez só, com a última nota
    await expect(page.getByTestId("stage-vote-status")).toContainText("voto registrado: 3");
    const v = await db
      .prepare("SELECT score FROM live_votes WHERE hackathonId = ? AND memberId = ? AND teamId = ?")
      .get<{ score: number }>(STAGE, me, stageA);
    expect(Number(v!.score)).toBe(3);
    expect(await axeSerious(page)).toEqual([]);
    await noHorizontalScroll(page, "votar-390");
  });

  test("/admin/h/[id]/juri: radios com setas, motivo da falta no publicar e axe sem violação séria", async ({ memberPage: page }) => {
    await page.goto(`/admin/h/${JURY}/juri`);
    await expect(page.getByTestId("publish-missing")).toHaveText(/falta.*3 notas em 2 avaliações/i);
    await expect(page.getByTestId("ranking-incomplete").first()).toBeVisible();

    const imp1 = page.getByRole("radio", { name: "Impacto: nota 1" }).nth(1);
    await imp1.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("radio", { name: "Impacto: nota 2" }).nth(1)).toBeChecked();

    // publicar com falta abre o pedido de motivo; cancelar não publica
    await page.getByRole("button", { name: "publicar resultado" }).click();
    await expect(page.getByRole("button", { name: "publicar mesmo assim" })).toBeDisabled();
    await page.getByRole("button", { name: "cancelar" }).click();

    expect(await axeSerious(page)).toEqual([]);
    await noHorizontalScroll(page, "juri-390");
  });

  test("/admin/h/[id]/palco: copy sem jargão e motivo do botão desligado", async ({ memberPage: page }) => {
    await page.goto(`/admin/h/${STAGE}/palco`);
    await expect(page.getByText(/fila de pitches/)).toBeVisible();
    await expect(page.getByText("FILA.exe")).toHaveCount(0);
    expect(await axeSerious(page)).toEqual([]);
    await noHorizontalScroll(page, "palco-390");
  });

  test("/admin/h/[id]/certificados: papel sem horas trava a emissão com o motivo", async ({ memberPage: page }) => {
    await page.goto(`/admin/h/${JURY}/certificados`);
    await expect(page.getByTestId("missing-hours")).toContainText("jurado(a)");
    await expect(page.getByRole("button", { name: "emitir certificados" })).toBeDisabled();
    await noHorizontalScroll(page, "certificados-390");
  });

  test("/c/[code] revogado diz revogado e não oferece PDF", async ({ page }) => {
    await page.goto(`/c/${REVOKED}`);
    await expect(page.getByTestId("cert-revoked")).toContainText(/revogado/i);
    await expect(page.getByText(/certificado válido/i)).toHaveCount(0);
    await expect(page.getByRole("link", { name: /baixar pdf/i })).toHaveCount(0);
    // e o link direto do PDF, pra quem já o tinha guardado, também não entrega o arquivo
    const pdf = await page.request.get(`/c/${REVOKED}/pdf`);
    expect(pdf.status()).toBe(410);
    expect(pdf.headers()["content-type"]).not.toContain("application/pdf");
    await noHorizontalScroll(page, "cert-revogado-390");
  });
});
