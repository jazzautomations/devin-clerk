import { expect, test } from "@playwright/test";
import { openE2eDb } from "./db";

// BDD da trajetória no perfil — spec 029. Leitura é pública; o seed vincula
// membro a time/inscrição direto no banco do dev server (pattern de
// talento.spec.ts): campeão na 1ª edição, projeto sem pódio na 2ª e
// inscrição sem time na 3ª — arco de 3 edições, antiga → nova.

const MEMBER = "e2e_arc";

// idempotente: membro + time campeão do seed (reusa o "One Day Hospital" —
// um segundo placement=1 quebraria o pódio único do arquivo), time próprio
// com projeto na PUC e inscrição solta no Anhembi
function ensureArc(): void {
  const db = openE2eDb();
  db.pragma("busy_timeout = 5000");

  db.prepare(
    `INSERT OR IGNORE INTO members (clerkId, username, email)
     VALUES ('e2e_arc', 'e2e_arc', 'e2e_arc@t.dev')`,
  ).run();
  db.prepare("UPDATE members SET name = 'Arc E2E' WHERE clerkId = 'e2e_arc'").run();
  const memberId = (
    db.prepare("SELECT id FROM members WHERE username = ?").get(MEMBER) as {
      id: number;
    }
  ).id;

  // 1) campeão na Unifacens (time+projeto do seed de lib/db.ts)
  let team = db
    .prepare("SELECT id FROM teams WHERE hackathonId = ? AND name = ?")
    .get("hack-inova-unifacens-2026", "One Day Hospital") as
    | { id: number }
    | undefined;
  if (!team) {
    // fallback p/ banco sem o seed do bootstrap
    const res = db
      .prepare(
        "INSERT INTO teams (hackathonId, name, placement) VALUES (?, ?, 1)",
      )
      .run("hack-inova-unifacens-2026", "One Day Hospital");
    team = { id: Number(res.lastInsertRowid) };
    db.prepare(
      "INSERT INTO team_projects (teamId, title, description) VALUES (?, ?, ?)",
    ).run(team.id, "One Day Hospital", "seed e2e");
  }
  db.prepare(
    "INSERT OR IGNORE INTO team_members (teamId, username) VALUES (?, ?)",
  ).run(team.id, MEMBER);

  // 2) time sem pódio COM projeto na PUC — vínculo sem inscrição
  let pucTeam = db
    .prepare("SELECT id FROM teams WHERE hackathonId = ? AND name = ?")
    .get("hack-inova-puc-saude-2026", "E2E Arc Squad") as
    | { id: number }
    | undefined;
  if (!pucTeam) {
    const res = db
      .prepare(
        "INSERT INTO teams (hackathonId, name, placement) VALUES (?, ?, 0)",
      )
      .run("hack-inova-puc-saude-2026", "E2E Arc Squad");
    pucTeam = { id: Number(res.lastInsertRowid) };
  }
  db.prepare(
    "INSERT OR IGNORE INTO team_members (teamId, username) VALUES (?, ?)",
  ).run(pucTeam.id, MEMBER);
  db.prepare(
    "INSERT OR IGNORE INTO team_projects (teamId, title) VALUES (?, ?)",
  ).run(pucTeam.id, "Arc Delivery");

  // 3) inscrição sem time no Anhembi — "participou"
  db.prepare(
    "INSERT OR IGNORE INTO registrations (memberId, hackathonId) VALUES (?, ?)",
  ).run(memberId, "hackinova-os-2-anhembi-2026");

  // membro-controle sem participação nenhuma (seção não deve renderizar)
  db.prepare(
    `INSERT OR IGNORE INTO members (clerkId, username, email)
     VALUES ('e2e_arc_zero', 'e2e_arc_zero', 'e2e_arc_zero@t.dev')`,
  ).run();

  db.close();
}

test.describe("trajetória do builder — arco de edições no perfil", () => {
  test("perfil mostra a faixa com desfechos em ordem cronológica", async ({
    page,
  }) => {
    ensureArc();
    const res = await page.goto(`/u/${MEMBER}`);
    expect(res?.status()).toBe(200);

    await expect(page.getByText("// trajetória")).toBeVisible();
    // linha-resumo: 3 edições, 1 pódio (1º Unifacens), 2 projetos entregues
    await expect(
      page.getByText(/3 edições · 1 pódio · 2 projetos entregues/),
    ).toBeVisible();

    const arc = page.getByRole("list", { name: "trajetória" });
    // ordem antiga → nova: Unifacens (ago) → PUC (set) → Anhembi (set, depois)
    const links = arc.locator("a");
    await expect(links).toHaveCount(3);
    await expect(links.nth(0)).toHaveAttribute(
      "href",
      "/h/hack-inova-unifacens-2026",
    );
    await expect(links.nth(1)).toHaveAttribute(
      "href",
      "/h/hack-inova-puc-saude-2026",
    );
    await expect(links.nth(2)).toHaveAttribute(
      "href",
      "/h/hackinova-os-2-anhembi-2026",
    );
    await expect(arc.getByText("1º lugar")).toBeVisible();
    await expect(arc.getByText("entregou projeto")).toBeVisible();
    await expect(arc.getByText("participou")).toBeVisible();
  });

  test("membro sem participação não renderiza a seção", async ({ page }) => {
    ensureArc();
    const res = await page.goto("/u/e2e_arc_zero");
    expect(res?.status()).toBe(200);
    await expect(page.getByText("// trajetória")).toHaveCount(0);
    // perfil continua íntegro — heading e empty state de campanhas
    await expect(
      page.getByRole("heading", { name: "@e2e_arc_zero" }),
    ).toBeVisible();
    await expect(
      page.getByText(/ainda não participou de hackathon/i),
    ).toBeVisible();
  });
});
