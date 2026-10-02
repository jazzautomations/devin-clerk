import { expect, test, type APIRequestContext } from "@playwright/test";
import { openE2eDb } from "./db";

// BDD do spec 030 — duas pontas da completude da edição:
// (A) /h/[id] de edição ongoing (startsAt passado, endsAt futuro — janela
//     Devpost rolando) fica viva: faixa de arena "em andamento", countdown
//     "termina em", seção de inscritos presente; o modo arquivo ("resultado",
//     "// arquivo") NÃO aparece. Edição encerrada segue intocada.
// (B) submissão rica: videoUrl vira link "▶ vídeo" na ficha /p/[teamId] e
//     logoUrl vira thumb 32px no card de /projetos. Tudo leitura pública —
//     os campos entram seedados direto no banco do dev server.
const ONGOING = "e2e-030-ongoing";
const OVER = "e2e-030-over";
const VIDEO = "https://youtu.be/e2e030";
const LOGO = "https://img.e2e.dev/logo-030.png";

// withTeam: só os testes de submissão rica querem time na edição ongoing —
// qualquer time faz hasArchive ligar a seção "resultado" (comportamento
// legado de standings ao vivo), e o teste de arena cobre o recorte limpo:
// edição rolando, sem resultados → nada de modo arquivo na tela
async function seed(
  request: APIRequestContext,
  withTeam = false,
): Promise<number | null> {
  // dev server faz init do db ao servir qualquer rota — bate uma antes
  await request.get("/radar");
  const db = openE2eDb();
  db.pragma("busy_timeout = 5000");
  // as colunas novas chegam pelo ALTER guardado de lib/archive.ts quando o
  // server importa o módulo — garante aqui caso o seed rode antes (pattern
  // idempotente dos outros specs e2e)
  const tpCols = (
    db.prepare("PRAGMA table_info(team_projects)").all() as { name: string }[]
  ).map((c) => c.name);
  for (const c of ["videoUrl", "logoUrl"]) {
    if (!tpCols.includes(c)) {
      db.exec(`ALTER TABLE team_projects ADD COLUMN ${c} TEXT`);
    }
  }
  const now = Date.now();
  const iso = (t: number) => new Date(t).toISOString();
  const day = 86_400_000;
  db.prepare(
    `INSERT INTO hackathons
       (id, name, organizer, startsAt, endsAt, format, registrationUrl,
        registrationDeadline, tags, active, source)
     VALUES (?, 'E2E 030 Ongoing Jam', 'E2E Org', ?, ?, 'online',
             'https://e2e.dev/030', ?, '[]', 1, 'e2e')
     ON CONFLICT(id) DO UPDATE SET startsAt = excluded.startsAt,
       endsAt = excluded.endsAt,
       registrationDeadline = excluded.registrationDeadline, active = 1`,
  ).run(ONGOING, iso(now - 3 * day), iso(now + 10 * day), iso(now + 10 * day));
  db.prepare(
    `INSERT INTO hackathons
       (id, name, organizer, startsAt, endsAt, format, registrationUrl,
        tags, active, source)
     VALUES (?, 'E2E 030 Over Jam', 'E2E Org', ?, ?, 'online',
             'https://e2e.dev/030over', '[]', 1, 'e2e')
     ON CONFLICT(id) DO UPDATE SET startsAt = excluded.startsAt,
       endsAt = excluded.endsAt, active = 1`,
  ).run(OVER, iso(now - 10 * day), iso(now - 9 * day));
  // inscrito na edição ongoing — seção "inscritos" precisa de ≥1
  db.prepare(
    "INSERT OR IGNORE INTO members (clerkId, username, email) VALUES ('e2e_030', 'e2e_030', 'e2e-030@t.dev')",
  ).run();
  const m = db
    .prepare("SELECT id FROM members WHERE clerkId = 'e2e_030'")
    .get() as { id: number };
  db.prepare(
    "INSERT OR IGNORE INTO registrations (memberId, hackathonId) VALUES (?, ?)",
  ).run(m.id, ONGOING);
  // time + projeto rico na edição ongoing — alimenta /p/[teamId] e /projetos;
  // FK: filhos (projects/members) saem antes do time, senão a re-seed trava
  db.prepare(
    `DELETE FROM team_projects WHERE teamId IN
       (SELECT id FROM teams WHERE hackathonId = ?)`,
  ).run(ONGOING);
  db.prepare(
    `DELETE FROM team_members WHERE teamId IN
       (SELECT id FROM teams WHERE hackathonId = ?)`,
  ).run(ONGOING);
  db.prepare("DELETE FROM teams WHERE hackathonId = ?").run(ONGOING);
  let teamId: number | null = null;
  if (withTeam) {
    db.prepare(
      "INSERT INTO teams (hackathonId, name, placement) VALUES (?, 'E2E Rich Team', 0)",
    ).run(ONGOING);
    const t = db
      .prepare(
        "SELECT id FROM teams WHERE hackathonId = ? AND name = 'E2E Rich Team'",
      )
      .get(ONGOING) as { id: number };
    db.prepare(
      `INSERT OR REPLACE INTO team_projects
         (teamId, title, description, repoUrl, videoUrl, logoUrl)
       VALUES (?, 'E2E Projeto Rico', 'projeto com pitch em vídeo e logo',
               'https://github.com/e2e/rich', ?, ?)`,
    ).run(t.id, VIDEO, LOGO);
    teamId = t.id;
  }
  db.close();
  return teamId;
}

test.describe("/h/[id] de edição ongoing fica viva — spec 030", () => {
  test("arena 'em andamento' + countdown 'termina em'; sem modo arquivo", async ({
    page,
    request,
  }) => {
    await seed(request);
    await page.goto(`/h/${ONGOING}`);
    await expect(page.getByText("// hackathon", { exact: true })).toBeVisible();

    const strip = page.getByTestId("arena-strip");
    await expect(strip).toBeVisible();
    await expect(strip.getByTestId("arena-phase")).toContainText(
      "em andamento",
    );
    await expect(strip.getByTestId("arena-countdown")).toContainText(
      /termina em/,
    );

    // o bug de 027-residual: ongoing renderizava arquivo — heading fora
    await expect(
      page.getByRole("heading", { name: "resultado" }),
    ).toHaveCount(0);
    await expect(page.getByText("// arquivo")).toHaveCount(0);
    // inscritos não somem numa edição rolando
    await expect(page.getByText(/inscritos \(\d+\)/)).toBeVisible();
  });

  test("edição encerrada continua em modo arquivo (complemento exato)", async ({
    page,
    request,
  }) => {
    await seed(request);
    await page.goto(`/h/${OVER}`);
    await expect(
      page.getByText("// arquivo", { exact: true }),
    ).toBeVisible();
    await expect(page.getByTestId("arena-strip")).toHaveCount(0);
    await expect(
      page.getByRole("heading", { name: "resultado" }),
    ).toBeVisible();
  });
});

test.describe("submissão rica — vídeo na ficha, logo no card", () => {
  test("/p/[teamId] mostra '▶ vídeo' externo junto de repo", async ({
    page,
    request,
  }) => {
    const teamId = await seed(request, true);
    await page.goto(`/p/${teamId}`);
    const video = page.getByRole("link", { name: /vídeo/ });
    await expect(video).toBeVisible();
    await expect(video).toHaveAttribute("href", VIDEO);
    await expect(video).toHaveAttribute("target", "_blank");
    await expect(
      page.getByRole("link", { name: /repositório/ }),
    ).toBeVisible();
  });

  test("/projetos renderiza thumb 32px do logo; sem logoUrl nenhum img", async ({
    page,
    request,
  }) => {
    await seed(request, true);
    await page.goto("/projetos");
    const card = page.locator("li", { hasText: "E2E Projeto Rico" });
    await expect(card).toHaveCount(1);
    await expect(card.locator(`img[src="${LOGO}"]`)).toBeVisible();
    // card legado (seed One Day Hospital, sem logoUrl) não renderiza img
    const legacy = page.locator("li", { hasText: "One Day Hospital" });
    await expect(legacy).toHaveCount(1);
    await expect(legacy.locator("img")).toHaveCount(0);
  });
});
