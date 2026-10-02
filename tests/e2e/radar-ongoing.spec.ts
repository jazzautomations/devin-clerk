import { expect, test, type APIRequestContext } from "@playwright/test";
import { openE2eDb } from "./db";

// BDD do spec 027 — evento em andamento (janela de submissão já abriu, ainda
// não fechou — padrão Devpost) aparece no radar marcado "em andamento"; e a
// landing mostra "+N · 30d" onde há timestamp real.
// Eventos e2e próprios (source='e2e', datas relativas a agora) — não colidem
// com seeds nem com raspados reais.
const ONGOING = "e2e-ongoing-jam";
const OVER = "e2e-over-jam";

async function ensureOngoingEvents(
  request: APIRequestContext,
): Promise<void> {
  // bate /radar primeiro pra forçar o init/migrações do db no dev server
  await request.get("/radar");
  const db = openE2eDb();
  db.pragma("busy_timeout = 5000");
  const cols = (
    db.prepare("PRAGMA table_info(hackathons)").all() as { name: string }[]
  ).map((c) => c.name);
  for (const c of ["first_seen", "last_seen"]) {
    if (!cols.includes(c)) {
      db.exec(`ALTER TABLE hackathons ADD COLUMN ${c} TEXT`);
    }
  }
  const now = Date.now();
  const iso = (t: number) => new Date(t).toISOString();
  const day = 86_400_000;
  db.prepare(
    `INSERT INTO hackathons
       (id, name, organizer, startsAt, endsAt, format, registrationUrl,
        registrationDeadline, tags, active, source, first_seen, last_seen)
     VALUES (?, 'E2E Ongoing Jam', 'E2E Org', ?, ?, 'online',
             'https://e2e.dev/ongoing', ?, '[]', 1, 'e2e', ?, ?)
     ON CONFLICT(id) DO UPDATE SET startsAt = excluded.startsAt,
       endsAt = excluded.endsAt,
       registrationDeadline = excluded.registrationDeadline,
       first_seen = excluded.first_seen, last_seen = excluded.last_seen,
       active = 1`,
  ).run(
    ONGOING,
    iso(now - 3 * day), // janela abriu há 3 dias — startsAt no passado
    iso(now + 10 * day), // fecha daqui a 10 — ainda rolando
    iso(now + 10 * day),
    iso(now),
    iso(now),
  );
  db.prepare(
    `INSERT INTO hackathons
       (id, name, organizer, startsAt, endsAt, format, registrationUrl,
        tags, active, source)
     VALUES (?, 'E2E Over Jam', 'E2E Org', ?, ?, 'online',
             'https://e2e.dev/over', '[]', 1, 'e2e')
     ON CONFLICT(id) DO UPDATE SET startsAt = excluded.startsAt,
       endsAt = excluded.endsAt, active = 1`,
  ).run(OVER, iso(now - 10 * day), iso(now - 9 * day)); // já acabou
  db.close();
}

test.describe("radar mostra eventos em andamento — spec 027", () => {
  test("evento ongoing aparece no radar marcado 'em andamento · até'", async ({
    page,
    request,
  }) => {
    await ensureOngoingEvents(request);
    await page.goto("/radar?q=ongoing jam");
    const card = page.locator("article", { hasText: "E2E Ongoing Jam" });
    await expect(card).toHaveCount(1);
    await expect(card.getByText(/em andamento · até/i)).toBeVisible();
  });

  test("evento encerrado não aparece entre os abertos", async ({
    page,
    request,
  }) => {
    await ensureOngoingEvents(request);
    await page.goto("/radar?q=over jam");
    await expect(
      page.locator("article", { hasText: "E2E Over Jam" }),
    ).toHaveCount(0);
    await expect(
      page.getByText(/nada no radar pra "over jam"/i),
    ).toBeVisible();
  });

  test("landing mostra '+N · 30d' quando há atividade na janela", async ({
    page,
    request,
  }) => {
    // first_seen=agora do evento ongoing garante ≥1 no delta de eventos
    await ensureOngoingEvents(request);
    await page.goto("/");
    await expect(page.getByText(/^\+\d+ · 30d$/).first()).toBeVisible();
    // "edições no arquivo" não tem timestamp real de entrada → sem momentum
    const arquivo = page
      .locator("dl > div")
      .filter({ hasText: "edições no arquivo" });
    await expect(arquivo.getByText(/· 30d/)).toHaveCount(0);
  });
});
