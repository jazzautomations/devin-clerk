import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { grantEditionRole } from "@/lib/roles";

// spec 033 US2/US3 — API de avisos, cron do worker, dúvidas, contato do
// perfil e webhook de bounce. Guardas 401/403 e caminho feliz.

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

const H = "avisos-api";
let seq = 0;
async function member(opts: { role?: string; status?: string; edition?: string } = {}) {
  const tag = `ap${seq++}`;
  const row = await db
    .prepare("INSERT INTO members (clerkId, username, email, role) VALUES (?, ?, ?, ?) RETURNING id")
    .get<{ id: number }>(`clerk_${tag}`, `u_${tag}`, `${tag}@t.dev`, opts.role ?? "member");
  if (opts.status) {
    await db
      .prepare("INSERT INTO registrations (memberId, hackathonId, status) VALUES (?, ?, ?)")
      .run(row!.id, H, opts.status);
  }
  if (opts.edition) await grantEditionRole(H, row!.id, opts.edition as "organizador", null);
  return { id: row!.id, clerkId: `clerk_${tag}`, username: `u_${tag}`, email: `${tag}@t.dev` };
}
const as = (m: { clerkId: string } | null) => {
  clerk.uid = m?.clerkId ?? null;
};
const json = (method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request("http://t", {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
const ctx = () => ({ params: Promise.resolve({ id: H }) });
const qctx = (qid: string) => ({ params: Promise.resolve({ id: H, qid }) });

beforeEach(async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  as(null);
  afterQueue.jobs = [];
  await db
    .prepare(
      `INSERT OR IGNORE INTO hackathons (id, name, organizer, startsAt, format, registrationUrl, source)
       VALUES (?, 'Avisos API', 'Hack Inova', '2027-01-01', 'presencial', 'https://x.dev', 'painel')`,
    )
    .run(H);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST/GET /api/admin/hackathons/[id]/announcements", () => {
  const aviso = { audience: "todos", title: "Credenciamento 8h", body: "Traga documento." };

  it("401 deslogado (JSON)", async () => {
    const { POST, GET } = await import("@/app/api/admin/hackathons/[id]/announcements/route");
    const res = await POST(json("POST", aviso), ctx());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect((await GET(json("GET"), ctx())).status).toBe(401);
  });

  it("403 pra inscrito e pra mentor (só organizador/admin publica)", async () => {
    const { POST } = await import("@/app/api/admin/hackathons/[id]/announcements/route");
    as(await member({ status: "approved" }));
    expect((await POST(json("POST", aviso), ctx())).status).toBe(403);
    as(await member({ edition: "mentor" }));
    expect((await POST(json("POST", aviso), ctx())).status).toBe(403);
  });

  it("400 com corpo inválido", async () => {
    const { POST } = await import("@/app/api/admin/hackathons/[id]/announcements/route");
    as(await member({ edition: "organizador" }));
    expect((await POST(json("POST", { audience: "todos", title: "" , body: "x" }), ctx())).status).toBe(400);
    expect((await POST(json("POST", "{"), ctx())).status).toBe(400);
  });

  it("200 organizador publica, fan-out enfileira e o worker roda no after()", async () => {
    const { POST, GET } = await import("@/app/api/admin/hackathons/[id]/announcements/route");
    const insc = await member({ status: "approved" });
    as(await member({ edition: "organizador" }));
    const res = await POST(json("POST", aviso), ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.queued).toBeGreaterThanOrEqual(2);
    await Promise.all(afterQueue.jobs);
    const rows = await db
      .prepare("SELECT channel, status FROM deliveries WHERE announcementId = ? AND memberId = ? ORDER BY channel")
      .all<{ channel: string; status: string }>(body.id, insc.id);
    // sem RESEND_API_KEY no teste: in-app entregue, e-mail pulado (driver log)
    expect(rows).toEqual([
      { channel: "email", status: "skipped" },
      { channel: "inapp", status: "sent" },
    ]);
    const list = await (await GET(json("GET"), ctx())).json();
    expect(list.announcements[0]).toMatchObject({ id: body.id, title: "Credenciamento 8h" });
    expect(list.announcements[0].stats.inapp.sent).toBeGreaterThanOrEqual(1);
  });

  it("200 admin global publica pra um time da edição; time de outra edição é 400", async () => {
    const { POST } = await import("@/app/api/admin/hackathons/[id]/announcements/route");
    as(await member({ role: "admin" }));
    const team = await db
      .prepare("INSERT INTO teams (hackathonId, name) VALUES (?, ?) RETURNING id")
      .get<{ id: number }>(H, `t${seq++}`);
    expect((await POST(json("POST", { ...aviso, audience: "time", teamId: team!.id }), ctx())).status).toBe(200);
    const other = await db
      .prepare("INSERT INTO teams (hackathonId, name) VALUES ('hack-inova-alphaville-2026', ?) RETURNING id")
      .get<{ id: number }>(`t${seq++}`);
    expect((await POST(json("POST", { ...aviso, audience: "time", teamId: other!.id }), ctx())).status).toBe(400);
  });
});

describe("GET /api/hackathons/[id]/announcements", () => {
  it("401 anon, 403 não inscrito, 200 inscrito", async () => {
    const { GET } = await import("@/app/api/hackathons/[id]/announcements/route");
    expect((await GET(json("GET"), ctx())).status).toBe(401);
    as(await member());
    expect((await GET(json("GET"), ctx())).status).toBe(403);
    as(await member({ status: "pending" }));
    const res = await GET(json("GET"), ctx());
    expect(res.status).toBe(200);
    expect(Array.isArray((await res.json()).announcements)).toBe(true);
  });
});

describe("POST /api/cron/deliveries", () => {
  it("401 sem secret configurado, sem header ou com token errado; 200 com Bearer certo", async () => {
    const { POST } = await import("@/app/api/cron/deliveries/route");
    vi.stubEnv("HACKAHUB_CRON_SECRET", "");
    expect((await POST(json("POST", undefined, { Authorization: "Bearer " }))).status).toBe(401);
    vi.stubEnv("HACKAHUB_CRON_SECRET", "s3cret-cron");
    expect((await POST(json("POST"))).status).toBe(401);
    expect((await POST(json("POST", undefined, { Authorization: "Bearer errado" }))).status).toBe(401);
    const ok = await POST(json("POST", undefined, { Authorization: "Bearer s3cret-cron" }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ processed: expect.any(Number) });
  });
});

describe("dúvidas — /api/hackathons/[id]/questions", () => {
  it("401 anon; 403 quem não é inscrito nem papel", async () => {
    const { GET, POST } = await import("@/app/api/hackathons/[id]/questions/route");
    expect((await GET(json("GET"), ctx())).status).toBe(401);
    expect((await POST(json("POST", { body: "x" }), ctx())).status).toBe(401);
    as(await member({ status: "rejected" }));
    expect((await GET(json("GET"), ctx())).status).toBe(403);
    expect((await POST(json("POST", { body: "x" }), ctx())).status).toBe(403);
  });

  it("inscrito pergunta; inscrito não responde (403); mentor responde (autor notificado) e resolve", async () => {
    const q = await import("@/app/api/hackathons/[id]/questions/route");
    const a = await import("@/app/api/hackathons/[id]/questions/[qid]/answers/route");
    const p = await import("@/app/api/hackathons/[id]/questions/[qid]/route");
    const ana = await member({ status: "approved" });
    as(ana);
    const created = await q.POST(json("POST", { body: "tem wifi?" }), ctx());
    expect(created.status).toBe(200);
    const { id } = await created.json();

    as(await member({ status: "approved" }));
    expect((await a.POST(json("POST", { body: "acho que sim" }), qctx(String(id)))).status).toBe(403);
    expect((await p.PATCH(json("PATCH", { resolved: true }), qctx(String(id)))).status).toBe(403);

    as(await member({ edition: "mentor" }));
    expect((await a.POST(json("POST", { body: "sim, rede HackInova" }), qctx(String(id)))).status).toBe(200);
    expect((await p.PATCH(json("PATCH", { resolved: true }), qctx(String(id)))).status).toBe(200);
    expect((await a.POST(json("POST", { body: "x" }), qctx("999999"))).status).toBe(404);

    const notifs = await db.prepare("SELECT type FROM notifications WHERE memberId = ?").all<{ type: string }>(ana.id);
    expect(notifs.map((n) => n.type)).toContain("answer");

    as(ana);
    const list = await (await q.GET(json("GET"), ctx())).json();
    const mine = list.questions.find((x: { id: number }) => x.id === id);
    expect(mine.resolvedAt).not.toBeNull();
    expect(mine.answers[0].body).toBe("sim, rede HackInova");
  });
});

describe("PATCH /api/members/me — telefone e opt-in de WhatsApp (FR-010)", () => {
  async function prefs(id: number) {
    return db
      .prepare("SELECT phone, whatsappOptIn, whatsappOptInAt FROM members WHERE id = ?")
      .get<{ phone: string | null; whatsappOptIn: number; whatsappOptInAt: string | null }>(id);
  }

  it("401 deslogado", async () => {
    const { PATCH } = await import("@/app/api/members/me/route");
    expect((await PATCH(json("PATCH", { phone: "11999999999" }))).status).toBe(401);
  });

  it("telefone inválido é 400; opt-in sem telefone é 400; nada é gravado", async () => {
    const { PATCH } = await import("@/app/api/members/me/route");
    const m = await member();
    as(m);
    expect((await PATCH(json("PATCH", { phone: "123", name: "Ana" }))).status).toBe(400);
    expect((await PATCH(json("PATCH", { whatsappOptIn: true }))).status).toBe(400);
    expect((await PATCH(json("PATCH", { whatsappOptIn: "sim" }))).status).toBe(400);
    expect(await prefs(m.id)).toEqual({ phone: null, whatsappOptIn: 0, whatsappOptInAt: null });
    const name = await db.prepare("SELECT name FROM members WHERE id = ?").get<{ name: string | null }>(m.id);
    expect(name!.name).toBeNull();
  });

  it("normaliza o telefone, registra a data do opt-in; limpar telefone derruba o opt-in", async () => {
    const { PATCH } = await import("@/app/api/members/me/route");
    const m = await member();
    as(m);
    expect((await PATCH(json("PATCH", { phone: "(11) 99999-9999", whatsappOptIn: true }))).status).toBe(200);
    const on = await prefs(m.id);
    expect(on).toMatchObject({ phone: "5511999999999", whatsappOptIn: 1 });
    expect(on!.whatsappOptInAt).toMatch(/^\d{4}-\d{2}-\d{2} /);
    // salvar o perfil sem mexer no contato preserva
    expect((await PATCH(json("PATCH", { name: "Ana" }))).status).toBe(200);
    expect(await prefs(m.id)).toEqual(on);
    expect((await PATCH(json("PATCH", { phone: "" }))).status).toBe(200);
    expect(await prefs(m.id)).toEqual({ phone: null, whatsappOptIn: 0, whatsappOptInAt: null });
  });
});

describe("POST /api/webhooks/resend — bounce", () => {
  const secretRaw = Buffer.from("segredo-de-teste-do-webhook");
  const secret = `whsec_${secretRaw.toString("base64")}`;
  function signed(payload: unknown, opts: { badSig?: boolean; ts?: number } = {}) {
    const body = JSON.stringify(payload);
    const id = "msg_1";
    const ts = String(opts.ts ?? Math.floor(Date.now() / 1000));
    const sig = createHmac("sha256", secretRaw).update(`${id}.${ts}.${body}`).digest("base64");
    return new Request("http://t", {
      method: "POST",
      headers: {
        "svix-id": id,
        "svix-timestamp": ts,
        "svix-signature": `v1,${opts.badSig ? "AAAA" + sig.slice(4) : sig}`,
      },
      body,
    });
  }

  it("assinatura inválida/antiga ou sem secret é 401; bounce válido marca o membro", async () => {
    const { POST } = await import("@/app/api/webhooks/resend/route");
    const m = await member();
    const evt = { type: "email.bounced", data: { to: [m.email] } };
    vi.stubEnv("RESEND_WEBHOOK_SECRET", "");
    expect((await POST(signed(evt))).status).toBe(401);
    vi.stubEnv("RESEND_WEBHOOK_SECRET", secret);
    expect((await POST(signed(evt, { badSig: true }))).status).toBe(401);
    expect((await POST(signed(evt, { ts: Math.floor(Date.now() / 1000) - 3600 }))).status).toBe(401);
    const ok = await POST(signed(evt));
    expect(ok.status).toBe(200);
    const row = await db.prepare("SELECT emailBouncedAt FROM members WHERE id = ?").get<{ emailBouncedAt: string | null }>(m.id);
    expect(row!.emailBouncedAt).not.toBeNull();
  });

  it("outros eventos são aceitos e ignorados", async () => {
    const { POST } = await import("@/app/api/webhooks/resend/route");
    vi.stubEnv("RESEND_WEBHOOK_SECRET", secret);
    const res = await POST(signed({ type: "email.delivered", data: { to: ["x@t.dev"] } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ignored: true });
  });
});
