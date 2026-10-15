import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { grantEditionRole } from "@/lib/roles";

// Programação da edição (roadmap 037 #4) — guardas 401/403/404 e caminho
// feliz do painel, .ics públicos e feed pessoal.

const clerk = vi.hoisted(() => ({ uid: null as string | null }));
const afterQueue = vi.hoisted(() => ({ jobs: [] as Promise<unknown>[] }));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: clerk.uid })),
  currentUser: vi.fn(async () => null),
}));
vi.mock("next/server", async (orig) => ({
  ...(await orig<typeof import("next/server")>()),
  after: (fn: () => unknown) => {
    afterQueue.jobs.push(Promise.resolve().then(fn));
  },
}));

const H = "prog-api";
let seq = 0;
async function member(opts: { role?: string; status?: string; edition?: string } = {}) {
  const tag = `sa${seq++}`;
  const row = await db
    .prepare("INSERT INTO members (clerkId, username, email, role) VALUES (?, ?, ?, ?) RETURNING id")
    .get<{ id: number }>(`clerk_${tag}`, `u_${tag}`, `${tag}@t.dev`, opts.role ?? "member");
  if (opts.status) {
    await db
      .prepare("INSERT INTO registrations (memberId, hackathonId, status) VALUES (?, ?, ?)")
      .run(row!.id, H, opts.status);
  }
  if (opts.edition) await grantEditionRole(H, row!.id, opts.edition as "organizador", null);
  return { id: row!.id, clerkId: `clerk_${tag}` };
}
const as = (m: { clerkId: string } | null) => {
  clerk.uid = m?.clerkId ?? null;
};
const req = (method: string, body?: unknown, url = "http://t") =>
  new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const ctx = () => ({ params: Promise.resolve({ id: H }) });
const ictx = (itemId: string) => ({ params: Promise.resolve({ id: H, itemId }) });
const item = (over: Record<string, unknown> = {}) => ({
  title: "Abertura",
  date: "2026-11-14",
  start: "09:00",
  end: "10:00",
  room: "Auditório",
  audience: "todos",
  kind: "abertura",
  ...over,
});

beforeEach(async () => {
  as(null);
  afterQueue.jobs = [];
  await db
    .prepare(
      `INSERT OR IGNORE INTO hackathons (id, name, organizer, startsAt, endsAt, format, location, registrationUrl, active, source)
       VALUES (?, 'Prog API', 'Hack Inova', '2026-11-14T09:00:00-03:00', '2026-11-15T18:00:00-03:00',
               'presencial', 'Alphaville', 'https://x.dev', 1, 'painel')`,
    )
    .run(H);
});
afterEach(() => vi.restoreAllMocks());

describe("API do painel /api/admin/hackathons/[id]/schedule", () => {
  it("401 deslogado em todas as rotas (JSON)", async () => {
    const list = await import("@/app/api/admin/hackathons/[id]/schedule/route");
    const one = await import("@/app/api/admin/hackathons/[id]/schedule/[itemId]/route");
    const pub = await import("@/app/api/admin/hackathons/[id]/schedule/publish/route");
    for (const res of [
      await list.GET(req("GET"), ctx()),
      await list.POST(req("POST", item()), ctx()),
      await one.PATCH(req("PATCH", item()), ictx("1")),
      await one.DELETE(req("DELETE"), ictx("1")),
      await pub.POST(req("POST", {}), ctx()),
    ]) {
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "Unauthorized" });
    }
  });

  it("403 pra inscrito, mentor e staff", async () => {
    const { POST, GET } = await import("@/app/api/admin/hackathons/[id]/schedule/route");
    for (const m of [await member({ status: "approved" }), await member({ edition: "mentor" }), await member({ edition: "staff" })]) {
      as(m);
      expect((await POST(req("POST", item()), ctx())).status).toBe(403);
      expect((await GET(req("GET"), ctx())).status).toBe(403);
    }
  });

  it("organizador cria, valida, edita, duplica, publica e remove", async () => {
    const list = await import("@/app/api/admin/hackathons/[id]/schedule/route");
    const one = await import("@/app/api/admin/hackathons/[id]/schedule/[itemId]/route");
    const pub = await import("@/app/api/admin/hackathons/[id]/schedule/publish/route");
    as(await member({ edition: "organizador" }));

    const bad = await list.POST(req("POST", item({ end: "08:00" })), ctx());
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/fim/);
    expect((await list.POST(req("POST", item({ date: "2026-12-01" })), ctx())).status).toBe(400);

    const created = await list.POST(req("POST", item()), ctx());
    expect(created.status).toBe(201);
    const { item: it1 } = await created.json();
    expect(it1).toMatchObject({ title: "Abertura", date: "2026-11-14", start: "09:00", published: false });

    const dup = await list.POST(req("POST", { duplicateOf: it1.id }), ctx());
    expect(dup.status).toBe(201);
    expect((await dup.json()).item.title).toBe("Abertura (cópia)");
    expect((await list.POST(req("POST", { duplicateOf: 999999 }), ctx())).status).toBe(404);

    const p = await pub.POST(req("POST", { ids: [it1.id] }), ctx());
    expect(await p.json()).toEqual({ published: 1 });

    // aluno aprovado pra receber o aviso
    await member({ status: "approved" });
    const patched = await one.PATCH(req("PATCH", item({ start: "09:30", end: "10:30" })), ictx(String(it1.id)));
    expect(patched.status).toBe(200);
    const body = await patched.json();
    expect(body.item.start).toBe("09:30");
    expect(body.announcementId).toEqual(expect.any(Number));
    expect(afterQueue.jobs).toHaveLength(1);
    await Promise.all(afterQueue.jobs);

    expect((await one.PATCH(req("PATCH", item()), ictx("999999"))).status).toBe(404);
    expect((await one.DELETE(req("DELETE"), ictx(String(it1.id)))).status).toBe(200);
    expect((await one.DELETE(req("DELETE"), ictx(String(it1.id)))).status).toBe(404);

    const all = await (await list.GET(req("GET"), ctx())).json();
    expect(all.items.map((i: { title: string }) => i.title)).toEqual(["Abertura (cópia)"]);
  });

  it("admin global também pode; edição inexistente é 404", async () => {
    const { GET } = await import("@/app/api/admin/hackathons/[id]/schedule/route");
    as(await member({ role: "admin" }));
    expect((await GET(req("GET"), ctx())).status).toBe(200);
    expect((await GET(req("GET"), { params: Promise.resolve({ id: "nao-existe" }) })).status).toBe(404);
  });
});

async function seedItems() {
  const { createScheduleItem, publishSchedule, validateScheduleInput } = await import("@/lib/schedule");
  const ed = { startsAt: "2026-11-14T09:00:00-03:00", endsAt: "2026-11-15T18:00:00-03:00" };
  await db.prepare("DELETE FROM schedule_items WHERE hackathonId = ?").run(H);
  const open = await createScheduleItem(H, validateScheduleInput(item({ title: "Abertura, regras; boas-vindas" }), ed), null);
  const ment = await createScheduleItem(H, validateScheduleInput(item({ title: "Briefing dos mentores", audience: "mentores" }), ed), null);
  const draft = await createScheduleItem(H, validateScheduleInput(item({ title: "Rascunho secreto" }), ed), null);
  await publishSchedule(H, [open.id, ment.id]);
  return { open, ment, draft };
}

describe(".ics públicos", () => {
  it("feed da edição: text/calendar, só itens abertos e publicados", async () => {
    await seedItems();
    const { GET } = await import("@/app/h/[id]/programacao.ics/route");
    const res = await GET(req("GET"), ctx());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/calendar");
    const text = await res.text();
    expect(text).toContain("BEGIN:VCALENDAR");
    expect(text).toContain("SUMMARY:Abertura\\, regras\\; boas-vindas · Prog API");
    expect(text).not.toContain("Briefing");
    expect(text).not.toContain("Rascunho");
  });

  it("item: aberto pra anon; de mentores só com o papel; rascunho e lixo 404", async () => {
    const { open, ment, draft } = await seedItems();
    const { GET } = await import("@/app/h/[id]/programacao/[itemId]/route");
    const ok = await GET(req("GET"), ictx(`${open.id}.ics`));
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toContain("text/calendar");
    expect((await GET(req("GET"), ictx(`${ment.id}.ics`))).status).toBe(404);
    expect((await GET(req("GET"), ictx(`${draft.id}.ics`))).status).toBe(404);
    expect((await GET(req("GET"), ictx("abc.ics"))).status).toBe(404);
    expect((await GET(req("GET"), ictx(`${open.id}`))).status).toBe(404);
    as(await member({ edition: "mentor" }));
    expect((await GET(req("GET"), ictx(`${ment.id}.ics`))).status).toBe(200);
  });
});

describe("feed pessoal /api/me/calendar", () => {
  const url = `http://t/api/me/calendar?h=${H}`;

  it("401 deslogado, 403 sem inscrição/papel, 404 edição inexistente", async () => {
    const { GET, DELETE } = await import("@/app/api/me/calendar/route");
    expect((await GET(req("GET", undefined, url))).status).toBe(401);
    expect((await DELETE(req("DELETE", undefined, url))).status).toBe(401);
    as(await member());
    expect((await GET(req("GET", undefined, url))).status).toBe(403);
    expect((await GET(req("GET", undefined, "http://t/api/me/calendar?h=nada"))).status).toBe(404);
  });

  it("mentor recebe link; feed sem login traz os itens do papel; revogar mata o antigo", async () => {
    await seedItems();
    const { GET } = await import("@/app/api/me/calendar/route");
    const feed = await import("@/app/api/me/calendar/[token]/route");
    as(await member({ edition: "mentor" }));
    const { url: link, webcal } = await (await GET(req("GET", undefined, url))).json();
    expect(link).toMatch(/\/api\/me\/calendar\/HC1\.[^/]+\.ics$/);
    expect(webcal).toMatch(/^webcal:/);
    const token = link.split("/").pop()!;

    as(null); // app de calendário não tem sessão
    const res = await feed.GET(req("GET"), { params: Promise.resolve({ token }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/calendar");
    const text = await res.text();
    expect(text).toContain("Briefing dos mentores");
    expect(text).toContain("Abertura");
    expect(text).not.toContain("Rascunho");

    expect((await feed.GET(req("GET"), { params: Promise.resolve({ token: "HC1.x.y.ics" }) })).status).toBe(404);
  });

  it("revogar: link antigo vira 404", async () => {
    await seedItems();
    const { GET, DELETE } = await import("@/app/api/me/calendar/route");
    const feed = await import("@/app/api/me/calendar/[token]/route");
    as(await member({ status: "approved" }));
    const old = (await (await GET(req("GET", undefined, url))).json()).url.split("/").pop();
    const fresh = (await (await DELETE(req("DELETE", undefined, url))).json()).url.split("/").pop();
    expect(fresh).not.toBe(old);
    expect((await feed.GET(req("GET"), { params: Promise.resolve({ token: old }) })).status).toBe(404);
    expect((await feed.GET(req("GET"), { params: Promise.resolve({ token: fresh }) })).status).toBe(200);
  });
});
