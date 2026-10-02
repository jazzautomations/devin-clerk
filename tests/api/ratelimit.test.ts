import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import "@/lib/leads"; // schema próprio: tabela leads no :memory:
import { resetRateLimits } from "@/lib/ratelimit";

// spec 031 — e2e do 429 nas rotas. Estado do limiter é módulo-global:
// reseta no beforeEach e usa IPs de teste (TEST-NET/10.x) pra não
// dividir bucket 'anon' com os outros arquivos.

const clerk = vi.hoisted(() => ({ uid: "clerk_spam" as string | null }));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: clerk.uid })),
  currentUser: vi.fn(async () => null),
}));

const HID = "hack-inova-alphaville-2026"; // edição futura ativa (seed)

function memberId(clerkId: string): number {
  db.prepare(
    "INSERT OR IGNORE INTO members (clerkId, username, email) VALUES (?, ?, ?)",
  ).run(clerkId, `u_${clerkId}`, `${clerkId}@t.dev`);
  return (
    db.prepare("SELECT id FROM members WHERE clerkId = ?").get(clerkId) as {
      id: number;
    }
  ).id;
}

const leadReq = (ip: string, n: number) =>
  new Request("http://t/api/leads", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({
      company: "Spam Co",
      email: `spam-${ip}-${n}@t.dev`, // e-mail único — dedupe não interfere
      interest: "outro",
    }),
  });

const post = () => new Request("http://t", { method: "POST" });
const ctx = { params: Promise.resolve({ id: HID }) };

beforeEach(() => {
  resetRateLimits();
  clerk.uid = "clerk_spam";
  db.prepare("DELETE FROM leads").run();
  db.prepare("DELETE FROM registrations").run();
});

describe("POST /api/leads — 5/h por IP (rota pública)", () => {
  it("5 passam; a 6ª do mesmo IP → 429 + Retry-After, sem gravar", async () => {
    const { POST } = await import("@/app/api/leads/route");
    for (let i = 0; i < 5; i++) {
      const res = await POST(leadReq("203.0.113.1", i));
      expect(res.status).toBe(201);
    }
    const res = await POST(leadReq("203.0.113.1", 5));
    expect(res.status).toBe(429);
    const retry = res.headers.get("retry-after");
    expect(retry).toBeTruthy();
    const { error } = (await res.json()) as { error: string };
    expect(error).toContain("muitas requisições");
    expect(error).toContain(`${retry}s`);
    // o 6º não virou lead
    const n = (
      db.prepare("SELECT COUNT(*) n FROM leads").get() as { n: number }
    ).n;
    expect(n).toBe(5);
    // e outro IP segue livre — o limite é por chave
    const other = await POST(leadReq("203.0.113.2", 0));
    expect(other.status).toBe(201);
  });

  it("sem xff cai no bucket 'anon' — flood dev também é freado", async () => {
    const { POST } = await import("@/app/api/leads/route");
    const anon = (n: number) =>
      new Request("http://t/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company: "Co",
          email: `anon-${n}@t.dev`,
          interest: "outro",
        }),
      });
    for (let i = 0; i < 5; i++) {
      expect((await POST(anon(i))).status).toBe(201);
    }
    expect((await POST(anon(5))).status).toBe(429);
  });
});

describe("POST /api/hackathons/[id]/register — 10/h por member", () => {
  it("o 11º registro do mesmo membro → 429; outro membro segue livre", async () => {
    const { POST } = await import(
      "@/app/api/hackathons/[id]/register/route"
    );
    memberId("clerk_spam");
    memberId("clerk_livre");
    for (let i = 0; i < 10; i++) {
      const res = await POST(post(), ctx);
      expect(res.status).toBe(200);
    }
    const res = await POST(post(), ctx);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();

    // chave = memberId: o colega registra normal
    clerk.uid = "clerk_livre";
    const ok = await POST(post(), ctx);
    expect(ok.status).toBe(200);
  });
});
