import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { grantEditionRole } from "@/lib/roles";
import { rsvpToken } from "@/lib/rsvp";

// RSVP (migration 012) — guardas 401/403 e caminho feliz das rotas: cron,
// configuração/funil/export do organizador, reenvio e resposta pelo link.

const clerk = vi.hoisted(() => ({ uid: null as string | null }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: clerk.uid })),
  currentUser: vi.fn(async () => null),
}));

const H = "rsvp-api";
let seq = 0;
async function member(opts: { role?: string; status?: string; edition?: string } = {}) {
  const tag = `rsa${seq++}`;
  const row = await db
    .prepare("INSERT INTO members (clerkId, username, email, role) VALUES (?, ?, ?, ?) RETURNING id")
    .get<{ id: number }>(`clerk_${tag}`, `u_${tag}`, `${tag}@t.dev`, opts.role ?? "member");
  let registrationId: number | null = null;
  if (opts.status) {
    const r = await db
      .prepare("INSERT INTO registrations (memberId, hackathonId, status) VALUES (?, ?, ?) RETURNING id")
      .get<{ id: number }>(row!.id, H, opts.status);
    registrationId = r!.id;
  }
  if (opts.edition) await grantEditionRole(H, row!.id, opts.edition as "organizador", null);
  return { id: row!.id, clerkId: `clerk_${tag}`, registrationId };
}
const as = (m: { clerkId: string } | null) => {
  clerk.uid = m?.clerkId ?? null;
};
const req = (method: string, body?: unknown, headers: Record<string, string> = {}, url = "http://t") =>
  new Request(url, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
const ctx = () => ({ params: Promise.resolve({ id: H }) });
const tctx = (token: string) => ({ params: Promise.resolve({ token }) });
const future = (days: number) => new Date(Date.now() + days * 86_400_000);

beforeEach(async () => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  as(null);
  await db
    .prepare(
      `INSERT INTO hackathons (id, name, organizer, startsAt, format, registrationUrl, rsvpEnabled)
       VALUES (?, 'RSVP API', 'Hack Inova', ?, 'presencial', 'https://x.dev', 1)
       ON CONFLICT (id) DO UPDATE SET startsAt = excluded.startsAt`,
    )
    .run(H, future(5).toISOString());
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/cron/rsvp", () => {
  it("401 sem bearer, com bearer errado e sem a env configurada", async () => {
    const { POST } = await import("@/app/api/cron/rsvp/route");
    vi.stubEnv("HACKAHUB_CRON_SECRET", "segredo-cron");
    expect((await POST(req("POST"))).status).toBe(401);
    expect((await POST(req("POST", undefined, { Authorization: "Bearer chute" }))).status).toBe(401);
    const res = await POST(req("POST"));
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    vi.stubEnv("HACKAHUB_CRON_SECRET", "");
    expect((await POST(req("POST", undefined, { Authorization: "Bearer " }))).status).toBe(401);
  });

  it("200 com o bearer certo: convida aprovados da edição com janela aberta", async () => {
    const { POST } = await import("@/app/api/cron/rsvp/route");
    vi.stubEnv("HACKAHUB_CRON_SECRET", "segredo-cron");
    const m = await member({ status: "approved" });
    const res = await POST(req("POST", undefined, { Authorization: "Bearer segredo-cron" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.invited).toBeGreaterThanOrEqual(1);
    const row = await db.prepare("SELECT rsvpStatus FROM registrations WHERE id = ?").get(m.registrationId);
    expect(row).toEqual({ rsvpStatus: "pending" });
  });
});

describe("/api/admin/hackathons/[id]/rsvp", () => {
  const cfg = { enabled: true, opensDaysBefore: 7, deadlineDaysBefore: 3, overbookPercent: 10 };

  it("401 deslogado (JSON), 403 inscrito e staff", async () => {
    const { GET, PUT } = await import("@/app/api/admin/hackathons/[id]/rsvp/route");
    const r = await GET(req("GET"), ctx());
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: "Unauthorized" });
    expect((await PUT(req("PUT", cfg), ctx())).status).toBe(401);
    as(await member({ status: "approved" }));
    expect((await GET(req("GET"), ctx())).status).toBe(403);
    as(await member({ edition: "staff" }));
    expect((await PUT(req("PUT", cfg), ctx())).status).toBe(403);
  });

  it("200 organizador configura, vê funil e exporta CSV; 400 com config inválida", async () => {
    const { GET, PUT } = await import("@/app/api/admin/hackathons/[id]/rsvp/route");
    as(await member({ edition: "organizador" }));
    expect((await PUT(req("PUT", { ...cfg, deadlineDaysBefore: 9 }), ctx())).status).toBe(400);
    expect((await PUT(req("PUT", "{"), ctx())).status).toBe(400);
    const put = await PUT(req("PUT", cfg), ctx());
    expect(put.status).toBe(200);
    expect((await put.json()).config).toEqual(cfg);
    const got = await (await GET(req("GET"), ctx())).json();
    expect(got.config).toEqual(cfg);
    expect(got.funnel).toHaveProperty("confirmed");
    const csv = await GET(req("GET", undefined, {}, "http://t/x?format=csv"), ctx());
    expect(csv.headers.get("content-type")).toContain("text/csv");
    expect((await csv.text()).split("\n")[0]).toContain("username,nome,email,rsvp");
  });
});

describe("POST /api/admin/hackathons/[id]/rsvp/resend", () => {
  it("401/403/400/409/200", async () => {
    const { POST } = await import("@/app/api/admin/hackathons/[id]/rsvp/resend/route");
    const insc = await member({ status: "approved" });
    expect((await POST(req("POST", { memberId: insc.id }), ctx())).status).toBe(401);
    as(await member({ edition: "mentor" }));
    expect((await POST(req("POST", { memberId: insc.id }), ctx())).status).toBe(403);
    as(await member({ role: "admin" }));
    expect((await POST(req("POST", { memberId: "x" }), ctx())).status).toBe(400);
    expect((await POST(req("POST", { memberId: insc.id }), ctx())).status).toBe(409);
    await db
      .prepare("UPDATE registrations SET rsvpStatus = 'pending', rsvpDeadlineAt = ? WHERE id = ?")
      .run(future(3).toISOString().slice(0, 19).replace("T", " "), insc.registrationId);
    const ok = await POST(req("POST", { memberId: insc.id }), ctx());
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, kind: "invite" });
    expect((await POST(req("POST", { memberId: insc.id }), ctx())).status).toBe(429);
  });
});

describe("POST /api/rsvp/[token] (sem login)", () => {
  async function pending() {
    const m = await member({ status: "approved" });
    const deadline = future(3);
    await db
      .prepare("UPDATE registrations SET rsvpStatus = 'pending', rsvpDeadlineAt = ? WHERE id = ?")
      .run(deadline.toISOString().slice(0, 19).replace("T", " "), m.registrationId);
    return { ...m, token: rsvpToken(m.registrationId!, deadline) };
  }

  it("400 sem action; 404 token inválido; 410 expirado", async () => {
    const { POST } = await import("@/app/api/rsvp/[token]/route");
    const { token, registrationId } = await pending();
    expect((await POST(req("POST", {}), tctx(token))).status).toBe(400);
    expect((await POST(req("POST", { action: "confirm" }), tctx("R1.zz.zz.lixo"))).status).toBe(404);
    const old = rsvpToken(registrationId!, new Date(Date.now() - 60_000));
    expect((await POST(req("POST", { action: "confirm" }), tctx(old))).status).toBe(410);
  });

  it("200 confirma (idempotente) por JSON; formulário responde 303 de volta pra página", async () => {
    const { POST } = await import("@/app/api/rsvp/[token]/route");
    const { token, registrationId } = await pending();
    const first = await POST(req("POST", { action: "confirm" }), tctx(token));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true, status: "confirmed", already: false });
    const again = await (await POST(req("POST", { action: "confirm" }), tctx(token))).json();
    expect(again.already).toBe(true);

    const form = await POST(
      req("POST", "action=decline", { "Content-Type": "application/x-www-form-urlencoded" }),
      tctx(token),
    );
    expect(form.status).toBe(303);
    expect(form.headers.get("location")).toBe(`/rsvp/${token}?feito=declined`);
    expect(await db.prepare("SELECT 1 FROM registrations WHERE id = ?").get(registrationId)).toBeUndefined();
  });
});
