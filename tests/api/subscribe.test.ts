import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { resetRateLimits } from "@/lib/ratelimit";
import { PRIVACY_VERSION } from "@/lib/legal";
import { subscribersCsv } from "@/lib/subscribers";
import { subscribeDoneMessage } from "@/components/NewsletterForm";

// auditoria 041 pacote E — newsletter com limite, consentimento registrado,
// confirmação por e-mail, saída pelo link e planilha sem fórmula.

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn(async () => ({ userId: null })) }));

const post = (body: unknown, ip = "10.1.1.1") =>
  new Request("http://t/api/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });

beforeEach(async () => {
  resetRateLimits();
  vi.spyOn(console, "info").mockImplementation(() => {});
  await db.prepare("DELETE FROM subscribers").run();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("POST /api/subscribe", () => {
  it("6º POST do mesmo IP na mesma hora leva 429", async () => {
    const { POST } = await import("@/app/api/subscribe/route");
    for (let i = 0; i < 5; i++) {
      expect((await POST(post({ email: `a${i}@x.dev` }))).status).toBe(200);
    }
    const r = await POST(post({ email: "a6@x.dev" }));
    expect(r.status).toBe(429);
    expect((await r.json()).error).toMatch(/muitas requisições/);
    // outro IP segue passando
    expect((await POST(post({ email: "b@x.dev" }, "10.2.2.2"))).status).toBe(200);
  });

  it("grava data do aceite e versão da política, sem confirmar ainda (sem e-mail ligado)", async () => {
    const { POST } = await import("@/app/api/subscribe/route");
    const r = await POST(post({ email: "  Ana@X.dev " }));
    expect(await r.json()).toEqual({ ok: true, confirm: "pending" });
    const row = await db
      .prepare("SELECT email, consentAt, policyVersion, confirmedAt, confirmToken, unsubscribeToken FROM subscribers")
      .get<Record<string, string | null>>();
    expect(row?.email).toBe("ana@x.dev");
    expect(row?.consentAt).toBeTruthy();
    expect(row?.policyVersion).toBe(PRIVACY_VERSION);
    expect(row?.confirmedAt).toBeNull();
    expect(row?.confirmToken).toBeTruthy();
    expect(row?.unsubscribeToken).toBeTruthy();
  });

  it("e-mail acima de 254 caracteres ou inválido dá 400; honeypot finge sucesso e não grava", async () => {
    const { POST } = await import("@/app/api/subscribe/route");
    expect((await POST(post({ email: `${"a".repeat(250)}@x.dev` }))).status).toBe(400);
    expect((await POST(post({ email: "sem-arroba" }))).status).toBe(400);
    expect((await POST(post({ email: "bot@x.dev", website: "http://spam" }))).status).toBe(200);
    const n = await db.prepare("SELECT COUNT(*)::int AS n FROM subscribers").get<{ n: number }>();
    expect(Number(n?.n)).toBe(0);
  });

  it("com Resend ligado manda o link de confirmação; confirmar e sair funcionam pelo token", async () => {
    vi.stubEnv("RESEND_API_KEY", "re_test");
    const fetchMock = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { POST } = await import("@/app/api/subscribe/route");
    expect(await (await POST(post({ email: "bia@x.dev" }))).json()).toEqual({ ok: true, confirm: "sent" });
    const sent = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    const link = String(sent.text).match(/confirm\?token=([\w-]+)/)?.[1];
    expect(link).toBeTruthy();
    vi.unstubAllEnvs();

    const confirm = await import("@/app/api/subscribe/confirm/route");
    const confirmUrl = `http://t/api/subscribe/confirm?token=${link}`;
    // GET só mostra o botão: scanner de e-mail que abre o link não confirma
    const page0 = await confirm.GET(new Request(confirmUrl));
    expect(page0.status).toBe(200);
    expect(await page0.text()).toContain("<form method=\"post\"");
    const before = await db
      .prepare("SELECT confirmedAt FROM subscribers WHERE email = 'bia@x.dev'")
      .get<{ confirmedAt: string | null }>();
    expect(before?.confirmedAt).toBeNull();
    // POST (o clique no botão) grava a confirmação
    const ok = await confirm.POST(new Request(confirmUrl, { method: "POST" }));
    expect(ok.status).toBe(200);
    const row = await db
      .prepare("SELECT confirmedAt, unsubscribeToken FROM subscribers WHERE email = 'bia@x.dev'")
      .get<{ confirmedAt: string | null; unsubscribeToken: string }>();
    expect(row?.confirmedAt).toBeTruthy();
    expect((await confirm.POST(new Request("http://t/api/subscribe/confirm?token=nada", { method: "POST" }))).status).toBe(404);
    expect((await confirm.GET(new Request("http://t/api/subscribe/confirm"))).status).toBe(400);

    // GET de saída só mostra o botão (scanner de e-mail abre links sozinho)
    const out = await import("@/app/api/subscribe/unsubscribe/route");
    const url = `http://t/api/subscribe/unsubscribe?token=${row!.unsubscribeToken}`;
    const page = await out.GET(new Request(url));
    expect(await page.text()).toContain("<form method=\"post\"");
    expect(await db.prepare("SELECT 1 FROM subscribers WHERE email = 'bia@x.dev'").get()).toBeTruthy();
    // POST apaga a linha
    expect((await out.POST(new Request(url, { method: "POST" }))).status).toBe(200);
    expect(await db.prepare("SELECT 1 FROM subscribers WHERE email = 'bia@x.dev'").get()).toBeUndefined();
  });
});

describe("resposta da newsletter na tela", () => {
  it("sem e-mail ligado (pending) não promete e-mail agora", () => {
    const msg = subscribeDoneMessage("pending");
    expect(msg).toMatch(/ainda não começou/);
    expect(msg).not.toMatch(/antes do primeiro envio/i);
    expect(subscribeDoneMessage("sent")).toMatch(/link que mandamos/);
  });
});

describe("CSV de assinantes", () => {
  it("e-mail com =HYPERLINK(...)@a.co sai com prefixo ' e não vira fórmula", async () => {
    const evil = '=HYPERLINK("https://x.co","a")@a.co';
    const csv = subscribersCsv([
      { email: evil, createdAt: "2026-10-14 10:00:00", consentAt: null, policyVersion: "1.1", confirmedAt: null },
    ]);
    const line = csv.trim().split("\n")[1];
    expect(line.startsWith(`"'=HYPERLINK(`)).toBe(true);
    expect(line).not.toMatch(/^"?=/);
  });

  it("GET /api/admin/subscribers?format=csv usa o escape com prefixo", async () => {
    const { auth } = await import("@clerk/nextjs/server");
    await db
      .prepare("INSERT INTO members (clerkId, username, email, role) VALUES ('clerk_sub_admin','sub_admin','adm@t.dev','admin')")
      .run();
    vi.mocked(auth).mockResolvedValue({ userId: "clerk_sub_admin" } as never);
    await db.prepare("INSERT INTO subscribers (email) VALUES (?)").run("+5511@x.dev");
    const { GET } = await import("@/app/api/admin/subscribers/route");
    const body = await (await GET(new Request("http://t/api/admin/subscribers?format=csv"))).text();
    expect(body).toContain("'+5511@x.dev");
  });
});
