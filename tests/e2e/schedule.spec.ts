import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { memberRequest, test } from "./auth";
import { openE2eDb } from "./db";

// Programação da edição (roadmap 037 #4) pelo lado anônimo: itens abertos
// aparecem agrupados por dia, os de mentores e os rascunhos não vazam; .ics
// responde text/calendar e parseia; aba do painel exige login; bloco
// "agora / a seguir" entra na página da edição durante o evento. O caminho
// logado está nos testes de API.

const HACK = "e2e-programacao";
const LIVE = "e2e-programacao-live";
const SHOTS = process.env.E2E_SHOT_DIR;

const sql = (d: Date) => d.toISOString().slice(0, 19).replace("T", " ");

async function seed(request: APIRequestContext) {
  await request.get("/api/health"); // força init/migrações do server do e2e
  const db = openE2eDb();
  const start = new Date(Date.now() + 20 * 86_400_000);
  start.setUTCHours(12, 0, 0, 0);
  const liveStart = new Date(Date.now() - 2 * 3_600_000);
  const editions: [string, string, Date, Date][] = [
    [HACK, "E2E Programação Jam", start, new Date(start.getTime() + 30 * 3_600_000)],
    [LIVE, "E2E Programação Ao Vivo", liveStart, new Date(liveStart.getTime() + 24 * 3_600_000)],
  ];
  for (const [id, name, s, e] of editions) {
    await db
      .prepare(
        `INSERT INTO hackathons (id, name, organizer, startsAt, endsAt, format, location, registrationUrl, tags, active, source)
         VALUES (?, ?, 'Hack Inova E2E', ?, ?, 'presencial', 'Campus E2E', 'https://e2e.dev/prog', '[]', 1, 'e2e')
         ON CONFLICT(id) DO UPDATE SET startsAt = excluded.startsAt, endsAt = excluded.endsAt, active = 1`,
      )
      .run(id, name, s.toISOString(), e.toISOString());
    await db.prepare("DELETE FROM schedule_items WHERE hackathonId = ?").run(id);
  }
  const ins = db.prepare(
    `INSERT INTO schedule_items (hackathonId, title, description, startsAt, endsAt, room, audience, kind, publishedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const h = (base: Date, hours: number) => sql(new Date(base.getTime() + hours * 3_600_000));
  const pub = sql(new Date());
  await ins.run(HACK, "Abertura, regras; boas-vindas", "Credenciamento antes.", h(start, 0), h(start, 1), "Auditório", "todos", "abertura", pub);
  await ins.run(HACK, "Almoço", "", h(start, 3), h(start, 4), "Refeitório", "todos", "refeicao", pub);
  await ins.run(HACK, "Pitch final", "", h(start, 26), h(start, 28), "Auditório", "todos", "pitch", pub);
  await ins.run(HACK, "Briefing dos mentores (e2e)", "", h(start, -1), h(start, 0), "Sala 3", "mentores", "mentoria", pub);
  await ins.run(HACK, "Rascunho secreto (e2e)", "", h(start, 5), h(start, 6), "", "todos", "outro", null);
  await ins.run(LIVE, "Oficina rolando agora", "", h(liveStart, 1), h(liveStart, 3), "Lab 1", "todos", "oficina", pub);
  await ins.run(LIVE, "Jantar", "", h(liveStart, 5), h(liveStart, 6), "Refeitório", "todos", "refeicao", pub);
  const ids = await db
    .prepare("SELECT id, title FROM schedule_items WHERE hackathonId = ? ORDER BY id")
    .all<{ id: number; title: string }>(HACK);
  return Object.fromEntries(ids.map((r) => [r.title, r.id]));
}

async function noHorizontalScroll(page: Page) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(sw, "scroll horizontal").toBeLessThanOrEqual(iw);
}

/** desdobra (RFC 5545 §3.1) e valida a estrutura básica */
function parseIcs(text: string) {
  expect(text.endsWith("\r\n")).toBe(true);
  for (const raw of text.split("\r\n")) expect(new TextEncoder().encode(raw).length).toBeLessThanOrEqual(75);
  const lines = text.replace(/\r\n[ \t]/g, "").split("\r\n").filter(Boolean);
  expect(lines[0]).toBe("BEGIN:VCALENDAR");
  expect(lines.at(-1)).toBe("END:VCALENDAR");
  const events: Record<string, string>[] = [];
  let cur: Record<string, string> | null = null;
  for (const l of lines) {
    if (l === "BEGIN:VEVENT") cur = {};
    else if (l === "END:VEVENT") {
      events.push(cur!);
      cur = null;
    } else if (cur) {
      const i = l.indexOf(":");
      cur[l.slice(0, i)] = l.slice(i + 1);
    }
  }
  return events;
}

test.describe("programação da edição — sem login (037 #4)", () => {
  test("página pública agrupa por dia e esconde itens de mentores e rascunhos", async ({ memberPage: page, request }) => {
    await seed(request);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/h/${HACK}/programacao`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Programação", level: 1 })).toBeVisible();
    await expect(page.getByTestId("schedule-item")).toHaveCount(3);
    await expect(page.getByText("Abertura, regras; boas-vindas")).toBeVisible();
    await expect(page.getByText("sala Refeitório")).toBeVisible();
    expect(await page.getByTestId("schedule-day").count()).toBeGreaterThanOrEqual(2);
    await expect(page.getByText("Briefing dos mentores (e2e)")).toHaveCount(0);
    await expect(page.getByText("Rascunho secreto (e2e)")).toHaveCount(0);
    await expect(page.getByTestId("personal-feed")).toHaveCount(0);
    const google = await page.getByRole("link", { name: /Google Agenda/ }).first().getAttribute("href");
    expect(google).toMatch(/^https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE/);
    await noHorizontalScroll(page);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/programacao-390.png`, fullPage: true });
  });

  test("feed .ics da edição responde text/calendar e parseia", async ({ request }) => {
    await seed(request);
    const res = await request.get(`/h/${HACK}/programacao.ics`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/calendar");
    const events = parseIcs(await res.text());
    expect(events).toHaveLength(3);
    for (const e of events) {
      expect(e.UID).toMatch(/^programacao-\d+-e2e-programacao@/);
      expect(e.DTSTART).toMatch(/^\d{8}T\d{6}Z$/);
      expect(e.DTSTAMP).toMatch(/^\d{8}T\d{6}Z$/);
    }
    expect(events.map((e) => e.SUMMARY)).toContain("Abertura\\, regras\\; boas-vindas · E2E Programação Jam");
    // UID estável entre downloads
    const again = parseIcs(await (await request.get(`/h/${HACK}/programacao.ics`)).text());
    expect(again.map((e) => e.UID)).toEqual(events.map((e) => e.UID));
  });

  test(".ics de item (logado): aberto baixa; de mentores e rascunho são 404 pra quem não é mentor", async ({
    request: anon,
    memberPage,
  }) => {
    const ids = await seed(anon);
    // spec 039 — item avulso é de quem tem conta; o feed da edição (webcal) segue aberto
    expect((await anon.get(`/h/${HACK}/programacao/${ids["Almoço"]}.ics`, { maxRedirects: 0 })).status()).toBe(307);
    const request = await memberRequest(memberPage);
    const ok = await request.get(`/h/${HACK}/programacao/${ids["Almoço"]}.ics`);
    expect(ok.status()).toBe(200);
    expect(ok.headers()["content-type"]).toContain("text/calendar");
    expect(parseIcs(await ok.text())).toHaveLength(1);
    expect((await request.get(`/h/${HACK}/programacao/${ids["Briefing dos mentores (e2e)"]}.ics`)).status()).toBe(404);
    expect((await request.get(`/h/${HACK}/programacao/${ids["Rascunho secreto (e2e)"]}.ics`)).status()).toBe(404);
    expect((await request.get("/api/me/calendar/HC1.forjado.assinatura.ics")).status()).toBe(404);
  });

  test("aba /admin/h/[id]/programacao exige login e APIs respondem 401 JSON", async ({ page, request }) => {
    await seed(request);
    await page.goto(`/admin/h/${HACK}/programacao`);
    await expect(page).toHaveURL(/sign-in|sign-up|clerk/i, { timeout: 15000 });
    const calls = [
      request.get(`/api/admin/hackathons/${HACK}/schedule`),
      request.post(`/api/admin/hackathons/${HACK}/schedule`, { data: { title: "x" } }),
      request.fetch(`/api/admin/hackathons/${HACK}/schedule/1`, { method: "PATCH", data: { title: "x" } }),
      request.delete(`/api/admin/hackathons/${HACK}/schedule/1`),
      request.post(`/api/admin/hackathons/${HACK}/schedule/publish`, { data: {} }),
      request.get(`/api/me/calendar?h=${HACK}`),
      request.delete(`/api/me/calendar?h=${HACK}`),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status(), res.url()).toBe(401);
      expect(res.headers()["content-type"]).toContain("application/json");
    }
  });

  test("página da edição: 'agora / a seguir' durante o evento, link fora dele, subEvent no JSON-LD", async ({ memberPage: page, request }) => {
    await seed(request);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/h/${LIVE}`, { waitUntil: "domcontentloaded" });
    const block = page.getByTestId("schedule-now-next");
    await expect(block).toBeVisible();
    await expect(block.getByTestId("schedule-now")).toContainText("Oficina rolando agora");
    await expect(block.getByTestId("schedule-next")).toContainText("Jantar");
    await noHorizontalScroll(page);
    if (SHOTS) await block.screenshot({ path: `${SHOTS}/agora-a-seguir-390.png` });

    await page.goto(`/h/${HACK}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("schedule-now-next")).toHaveCount(0);
    await expect(page.getByTestId("schedule-link")).toContainText("3 itens");
    const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').first().textContent()) ?? "{}");
    expect(ld.subEvent).toHaveLength(3);
    expect(ld.subEvent.map((s: { name: string }) => s.name)).not.toContain("Briefing dos mentores (e2e)");
    await noHorizontalScroll(page);
  });
});
