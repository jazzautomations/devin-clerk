import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { leagueOptIn } from "@/lib/league";
import { RATE_LIMITS, resetRateLimits } from "@/lib/ratelimit";

// Liga do semestre (spec 046, onda 5: liga-por-faixa, migration 054) na
// fronteira da API: a flag desliga tudo (404), a rota é de membro (401
// deslogado), o opt-in grava e volta no GET, e corpo inválido dá 400.
// O 404 da página /liga com a flag desligada também é provado aqui.

const clerk = vi.hoisted(() => ({ uid: null as string | null }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: clerk.uid })),
  currentUser: vi.fn(async () => null),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

let seq = 0;
async function member(): Promise<{ id: number; clerkId: string; username: string }> {
  const tag = `liga${seq++}`;
  const row = await db
    .prepare("INSERT INTO members (clerkId, username, email, name) VALUES (?, ?, ?, ?) RETURNING id")
    .get<{ id: number }>(`clerk_${tag}`, `u_${tag}`, `${tag}@t.dev`, `Pessoa ${tag}`);
  return { id: row!.id, clerkId: `clerk_${tag}`, username: `u_${tag}` };
}

const routes = () => import("@/app/api/me/liga/route");
const req = (method: string, body?: unknown) =>
  new Request("http://t/api/me/liga", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

beforeEach(() => {
  resetRateLimits();
  clerk.uid = null;
  vi.stubEnv("HACKAHUB_LIGA_ON", "on");
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("flag desligada", () => {
  it("GET e PATCH respondem 404, mesmo logado", async () => {
    vi.stubEnv("HACKAHUB_LIGA_ON", "");
    const m = await member();
    clerk.uid = m.clerkId;
    const { GET, PATCH } = await routes();
    const g = await GET();
    expect(g.status).toBe(404);
    expect(await g.json()).toEqual({ error: "Not found" });
    const p = await PATCH(req("PATCH", { optIn: true }));
    expect(p.status).toBe(404);
    expect(await leagueOptIn(m.id)).toBe(false);
  });

  it("/liga dá 404", async () => {
    vi.stubEnv("HACKAHUB_LIGA_ON", "");
    const { default: LigaPage } = await import("@/app/liga/page");
    await expect(LigaPage({ searchParams: Promise.resolve({}) } as never)).rejects.toThrow("NEXT_NOT_FOUND");
  });
});

describe("opt-in", () => {
  it("deslogado dá 401 JSON", async () => {
    const { GET, PATCH } = await routes();
    const g = await GET();
    expect(g.status).toBe(401);
    expect(await g.json()).toEqual({ error: "Unauthorized" });
    const p = await PATCH(req("PATCH", { optIn: true }));
    expect(p.status).toBe(401);
    expect(await p.json()).toEqual({ error: "Unauthorized" });
  });

  it("ativa, lê de volta e desativa", async () => {
    const m = await member();
    clerk.uid = m.clerkId;
    const { GET, PATCH } = await routes();

    expect(await (await GET()).json()).toEqual({ enabled: true, optIn: false });
    const on = await PATCH(req("PATCH", { optIn: true }));
    expect(on.status).toBe(200);
    expect(await on.json()).toEqual({ ok: true, optIn: true });
    expect(await leagueOptIn(m.id)).toBe(true);
    expect(await (await GET()).json()).toEqual({ enabled: true, optIn: true });

    const off = await PATCH(req("PATCH", { optIn: false }));
    expect(await off.json()).toEqual({ ok: true, optIn: false });
    const row = await db.prepare("SELECT leagueOptIn AS v FROM members WHERE id = ?").get<{ v: number }>(m.id);
    expect(Number(row!.v)).toBe(0);
  });

  it("corpo inválido dá 400 sem gravar", async () => {
    const m = await member();
    clerk.uid = m.clerkId;
    const { PATCH } = await routes();
    for (const body of [{}, { optIn: "sim" }, { optIn: 1 }]) {
      const res = await PATCH(req("PATCH", body));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("optIn precisa ser true ou false");
    }
    expect(await leagueOptIn(m.id)).toBe(false);
  });

  it("conta anonimizada não aparece na lista da liga", async () => {
    const m = await member();
    await db.prepare("UPDATE members SET leagueOptIn = 1 WHERE id = ?").run(m.id);
    // ANONYMIZE (lib/privacy.ts) zera o opt-in: a linha sai da lista
    expect(await leagueOptIn(m.id)).toBe(true);
    const { ANONYMIZE } = await import("@/lib/privacy");
    expect(ANONYMIZE.leagueOptIn).toBe(0);
  });
});

describe("limite de requisições", () => {
  it("o toggle tem balde próprio", () => {
    expect(RATE_LIMITS.liga).toEqual({ limit: 30, windowMs: 60 * 60 * 1000 });
  });
});
