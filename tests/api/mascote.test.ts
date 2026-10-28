import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { hashMascote } from "@/lib/mascote/isometrico";
import { configFromSeed } from "@/lib/mascote/semente";
import { mascoteDoMembro, mascotePublico } from "@/lib/mascote/store";
import { PADRAO } from "@/lib/mascote/validar";
import { deleteMemberData } from "@/lib/privacy";
import { RATE_LIMITS, resetRateLimits } from "@/lib/ratelimit";
import type { MascoteConfig } from "@/lib/mascote/tipos";

// Bicho (migration 043): PUT /api/members/me/mascote (401, 400 por campo,
// 429, grava e recarrega), GET do próprio bicho, rota pública do SVG (CSP,
// cache por hash, semente do id 0 pra quem não existe ou excluiu a conta) e
// LGPD (o config some na exclusão).

const clerk = vi.hoisted(() => ({ uid: null as string | null }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: clerk.uid })),
  currentUser: vi.fn(async () => null),
  clerkClient: async () => ({ users: { deleteUser: vi.fn(async () => ({})) } }),
}));

let seq = 0;
async function member() {
  const tag = `bicho${seq++}`;
  const row = await db
    .prepare("INSERT INTO members (clerkId, username, email, name) VALUES (?, ?, ?, ?) RETURNING id")
    .get<{ id: number }>(`clerk_${tag}`, `u_${tag}`, `${tag}@t.dev`, `Pessoa ${tag}`);
  return { id: row!.id, clerkId: `clerk_${tag}` };
}
const as = (m: { clerkId: string } | null) => {
  clerk.uid = m?.clerkId ?? null;
};
const me = () => import("@/app/api/members/me/mascote/route");
const svgRoute = () => import("@/app/api/mascote/m/[id]/route");
const put = (body: unknown) =>
  new Request("http://t/api/members/me/mascote", { method: "PUT", body: typeof body === "string" ? body : JSON.stringify(body) });
const getSvg = async (id: string, v?: string) =>
  (await svgRoute()).GET(new Request(`http://t/api/mascote/m/${id}${v ? `?v=${v}` : ""}`), { params: Promise.resolve({ id }) });

const bom: MascoteConfig = {
  ...PADRAO,
  especie: "patinho",
  corPrincipal: "amarelo",
  corDetalhe: "laranja",
  topo: "cartola",
  mao: "caneca",
  acessorio: "oculos",
  pose: "danca",
  nome: "Quack",
};

beforeEach(() => {
  resetRateLimits();
  as(null);
});

describe("PUT /api/members/me/mascote", () => {
  it("sem sessão: 401 JSON", async () => {
    const res = await (await me()).PUT(put(bom));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect((await (await me()).GET()).status).toBe(401);
  });

  it("salva, devolve hash e src, e o GET traz o salvo", async () => {
    const m = await member();
    as(m);
    const antes = await (await (await me()).GET()).json();
    expect(antes.salvo).toBe(false);
    expect(antes.config).toEqual(configFromSeed(m.id));

    const res = await (await me()).PUT(put(bom));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({ ok: true, salvo: true, config: bom, hash: hashMascote(bom) });
    expect(data.src).toBe(`/api/mascote/m/${m.id}?v=${hashMascote(bom)}`);

    const depois = await (await (await me()).GET()).json();
    expect(depois).toMatchObject({ salvo: true, config: bom, hash: hashMascote(bom) });
    expect(depois.atualizadoEm).toBeTruthy();
    const row = await db.prepare("SELECT mascote FROM members WHERE id = ?").get<{ mascote: string }>(m.id);
    expect(JSON.parse(row!.mascote)).toEqual(bom);
  });

  it("aceita {config} e a versão antiga", async () => {
    const m = await member();
    as(m);
    const r1 = await (await me()).PUT(put({ config: { ...bom, nome: "Embrulhado" } }));
    expect(r1.status).toBe(200);
    const r2 = await (await me()).PUT(put({ v: 1, especie: "teclado", cor: "azul", acessorio: "gorro", olhos: "sono", nome: "Antigo" }));
    expect(r2.status).toBe(200);
    expect((await r2.json()).config).toMatchObject({ especie: "teclado", corPrincipal: "azul", topo: "gorro", acessorio: "nada" });
  });

  it("config inválido: 400 com a mensagem do campo e nada gravado", async () => {
    const m = await member();
    as(m);
    const res = await (await me()).PUT(put({ ...bom, especie: "dragao", nome: "https://golpe.com" }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(Object.keys(data.campos).sort()).toEqual(["especie", "nome"]);
    expect(data.error).toBe(data.campos.especie);
    expect(data.campos.nome).toMatch(/link/);
    const bad = await (await me()).PUT(put("{nao é json"));
    expect(bad.status).toBe(400);
    const nome = await (await me()).PUT(put({ ...bom, nome: "x".repeat(21) }));
    expect((await nome.json()).campos.nome).toMatch(/20/);
    const row = await db.prepare("SELECT mascote FROM members WHERE id = ?").get<{ mascote: string | null }>(m.id);
    expect(row!.mascote).toBeNull();
  });

  it(`rate limit: ${RATE_LIMITS.mascote.limit} por hora, depois 429 com Retry-After`, async () => {
    expect(RATE_LIMITS.mascote).toEqual({ limit: 30, windowMs: 3600_000 });
    const m = await member();
    as(m);
    const route = await me();
    for (let i = 0; i < 30; i++) expect((await route.PUT(put({ ...bom, nome: `N${i}` }))).status).toBe(200);
    const res = await route.PUT(put(bom));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    // o balde é por pessoa
    as(await member());
    expect((await route.PUT(put(bom))).status).toBe(200);
  });
});

describe("GET /api/mascote/m/[id]", () => {
  it("SVG público com CSP, nosniff e cache curto sem v", async () => {
    const m = await member();
    const res = await getSvg(String(m.id));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toMatch(/^image\/svg\+xml/);
    expect(res.headers.get("Content-Security-Policy")).toBe("default-src 'none'");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=300");
    const svg = await res.text();
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain(`<title>${configFromSeed(m.id).nome}</title>`);
    expect(res.headers.get("ETag")).toBe(`"${hashMascote(configFromSeed(m.id))}"`);
  });

  it("?v igual ao hash atual: imutável por 1 ano; v velho: 5 minutos", async () => {
    const m = await member();
    as(m);
    await (await me()).PUT(put(bom));
    const ok = await getSvg(String(m.id), hashMascote(bom));
    expect(ok.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    const velho = await getSvg(String(m.id), hashMascote(configFromSeed(m.id)));
    expect(velho.headers.get("Cache-Control")).toBe("public, max-age=300");
    expect(await ok.text()).toContain("<title>Quack</title>");
  });

  it("membro inexistente, id ruim ou conta excluída: bicho da semente do id 0", async () => {
    const zero = configFromSeed(0);
    for (const id of ["999999", "abc", "0", "-1", "1e9"]) {
      const res = await getSvg(id);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain(`<title>${zero.nome}</title>`);
    }
    const m = await member();
    as(m);
    await (await me()).PUT(put(bom));
    await deleteMemberData(m.id);
    expect(await mascotePublico(m.id)).toEqual(zero);
    expect(await (await getSvg(String(m.id))).text()).not.toContain("Quack");
  });
});

describe("LGPD", () => {
  it("exclusão zera mascote e mascoteUpdatedAt", async () => {
    const m = await member();
    as(m);
    await (await me()).PUT(put(bom));
    await deleteMemberData(m.id);
    const row = await db
      .prepare(`SELECT mascote, "mascoteUpdatedAt" AS "at" FROM members WHERE id = ?`)
      .get<{ mascote: string | null; at: string | null }>(m.id);
    expect(row).toEqual({ mascote: null, at: null });
    expect((await mascoteDoMembro(m.id)).salvo).toBe(false);
  });
});
