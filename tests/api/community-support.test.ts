import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { listLeads, listCommunityLeads, countCommunityLeads } from "@/lib/leads";
import { listSupporters } from "@/lib/communitySupporters";
import { resetRateLimits } from "@/lib/ratelimit";

// Apoio da comunidade (migration 028): apoiadores (cadastrar, ordenar,
// remover — só dono/organizador/admin, sem IDOR entre comunidades) e o
// "quero apoiar" público que vira lead ligado à comunidade e avisa a
// organização, com o rate limit do /api/leads.

const clerk = vi.hoisted(() => ({ uid: null as string | null }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: clerk.uid })),
  currentUser: vi.fn(async () => null),
}));

let seq = 0;
type M = { id: number; clerkId: string };
async function member(role = "member"): Promise<M> {
  const tag = `ap${seq++}`;
  const row = await db
    .prepare("INSERT INTO members (clerkId, username, email, name, role) VALUES (?, ?, ?, ?, ?) RETURNING id")
    .get<{ id: number }>(`clerk_${tag}`, `u_${tag}`, `${tag}@t.dev`, `Pessoa ${tag}`, role);
  return { id: row!.id, clerkId: `clerk_${tag}` };
}
const as = (m: { clerkId: string } | null) => {
  clerk.uid = m?.clerkId ?? null;
};
let ipSeq = 0;
const req = (method: string, body?: unknown, ip = `10.77.${Math.floor(ipSeq / 250)}.${ipSeq++ % 250}`) =>
  new Request("http://t", {
    method,
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) });

const routes = {
  supporters: () => import("@/app/api/communities/[slug]/supporters/route"),
  leads: () => import("@/app/api/leads/route"),
};

async function community(slug: string, owner: M | null, extra: { hidden?: number } = {}) {
  const c = await db
    .prepare("INSERT INTO communities (slug, name, city, createdBy, hidden) VALUES (?, ?, 'Recife, PE', ?, ?) RETURNING id")
    .get<{ id: number }>(slug, `Comunidade ${slug}`, owner?.id ?? null, extra.hidden ?? 0);
  if (owner) {
    await db.prepare("INSERT INTO community_members (communityId, memberId, role) VALUES (?, ?, 'dono')").run(c!.id, owner.id);
  }
  return { id: c!.id, slug };
}
async function addRole(communityId: number, m: M, role: "organizador" | "membro") {
  await db.prepare("INSERT INTO community_members (communityId, memberId, role) VALUES (?, ?, ?)").run(communityId, m.id, role);
}
async function add(slug: string, body: Record<string, unknown>) {
  const { POST } = await routes.supporters();
  return POST(req("POST", body), ctx(slug));
}
const notes = (memberId: number) =>
  db
    .prepare("SELECT type, text, href FROM notifications WHERE memberId = ? AND type = 'community_support' ORDER BY id")
    .all<{ type: string; text: string; href: string }>(memberId);

beforeEach(() => {
  resetRateLimits();
  as(null);
});

describe("apoiadores — permissões", () => {
  it("401 deslogado, 404 comunidade inexistente, 403 membro comum e de fora", async () => {
    const dono = await member();
    const c = await community("perm-apoio", dono);
    const { POST, PATCH, DELETE, GET } = await routes.supporters();
    const body = { name: "Padaria", kind: "comida" };
    expect((await POST(req("POST", body), ctx(c.slug))).status).toBe(401);
    expect((await PATCH(req("PATCH", { order: [] }), ctx(c.slug))).status).toBe(401);
    expect((await DELETE(req("DELETE", { id: 1 }), ctx(c.slug))).status).toBe(401);
    expect((await GET(req("GET"), ctx(c.slug))).status).toBe(401);
    const res401 = await POST(req("POST", body), ctx(c.slug));
    expect(await res401.json()).toEqual({ error: "Unauthorized" });

    const comum = await member();
    await addRole(c.id, comum, "membro");
    as(comum);
    expect((await POST(req("POST", body), ctx(c.slug))).status).toBe(403);
    as(await member());
    expect((await POST(req("POST", body), ctx(c.slug))).status).toBe(403);
    expect((await POST(req("POST", body), ctx("nao-existe"))).status).toBe(404);
    expect(await listSupporters(c.id)).toEqual([]);
  });

  it("dono, organizador e admin global cadastram", async () => {
    const dono = await member();
    const org = await member();
    const admin = await member("admin");
    const c = await community("quem-cadastra", dono);
    await addRole(c.id, org, "organizador");
    as(dono);
    expect((await add(c.slug, { name: "Loja Um", kind: "dinheiro" })).status).toBe(201);
    as(org);
    expect((await add(c.slug, { name: "Loja Dois", kind: "espaco" })).status).toBe(201);
    as(admin);
    expect((await add(c.slug, { name: "Loja Três", kind: "mentoria" })).status).toBe(201);
    expect((await listSupporters(c.id)).map((s) => [s.name, s.kind, s.position])).toEqual([
      ["Loja Um", "dinheiro", 1],
      ["Loja Dois", "espaco", 2],
      ["Loja Três", "mentoria", 3],
    ]);
  });

  it("comunidade escondida é 404 pro dono e segue pro admin", async () => {
    const dono = await member();
    const c = await community("escondida-apoio", dono, { hidden: 1 });
    as(dono);
    expect((await add(c.slug, { name: "Loja", kind: "outro" })).status).toBe(404);
    as(await member("admin"));
    expect((await add(c.slug, { name: "Loja", kind: "outro" })).status).toBe(201);
  });
});

describe("apoiadores — cadastrar, ordenar, remover", () => {
  it("cadastra com logo e link https; valida e recusa duplicado", async () => {
    const dono = await member();
    const c = await community("cadastro-apoio", dono);
    as(dono);
    const res = await add(c.slug, {
      name: "Café Recife",
      kind: "comida",
      url: "https://cafe.com.br",
      logoUrl: "https://cafe.com.br/logo.png",
      description: "café da manhã do hackathon",
    });
    expect(res.status).toBe(201);
    expect((await res.json()).supporter).toMatchObject({
      name: "Café Recife",
      kind: "comida",
      url: "https://cafe.com.br/",
      logoUrl: "https://cafe.com.br/logo.png",
      description: "café da manhã do hackathon",
      position: 1,
    });
    expect((await add(c.slug, { name: "café recife", kind: "outro" })).status).toBe(409);
    expect((await add(c.slug, { name: "Sem Tipo" })).status).toBe(400);
    expect((await add(c.slug, { name: "Logo Http", kind: "premio", logoUrl: "http://x.com/a.png" })).status).toBe(400);
    expect((await add(c.slug, { name: "Link Js", kind: "premio", url: "javascript:alert(1)" })).status).toBe(400);
    const { POST } = await routes.supporters();
    const bad = await POST(new Request("http://t", { method: "POST", body: "{" }), ctx(c.slug));
    expect(bad.status).toBe(400);
    expect(await listSupporters(c.id)).toHaveLength(1);
  });

  it("cadastro simultâneo: o mesmo nome entra uma vez só e o limite segura", async () => {
    const dono = await member();
    const c = await community("simultaneo-apoio", dono);
    as(dono);
    const res = await Promise.all([
      add(c.slug, { name: "Padaria do Centro", kind: "comida" }),
      add(c.slug, { name: "padaria do centro", kind: "comida" }),
    ]);
    expect(res.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await listSupporters(c.id)).map((s) => s.name)).toEqual(["Padaria do Centro"]);

    for (let i = 0; i < 38; i++) {
      await db.prepare("INSERT INTO community_supporters (communityId, name, kind, position) VALUES (?, ?, 'outro', ?)").run(c.id, `L${i}`, i + 2);
    }
    const last = await Promise.all([add(c.slug, { name: "Quase", kind: "outro" }), add(c.slug, { name: "Passou", kind: "outro" })]);
    expect(last.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await listSupporters(c.id)).toHaveLength(40);
  });

  it("o banco recusa nome repetido na mesma comunidade (índice único), não em outra", async () => {
    const a = await community("unico-a", await member());
    const b = await community("unico-b", await member());
    const ins = (id: number, name: string) =>
      db.prepare("INSERT INTO community_supporters (communityId, name, kind) VALUES (?, ?, 'outro')").run(id, name);
    await ins(a.id, "Loja Única");
    await expect(ins(a.id, "LOJA ÚNICA")).rejects.toMatchObject({ code: "23505" });
    await ins(b.id, "Loja Única");
  });

  it("limite de apoiadores por comunidade", async () => {
    const dono = await member();
    const c = await community("limite-apoio", dono);
    for (let i = 0; i < 40; i++) {
      await db.prepare("INSERT INTO community_supporters (communityId, name, kind, position) VALUES (?, ?, 'outro', ?)").run(c.id, `L${i}`, i);
    }
    as(dono);
    expect((await add(c.slug, { name: "Quadragésimo Primeiro", kind: "outro" })).status).toBe(409);
  });

  it("ordena com a lista inteira; id de outra comunidade é recusado (IDOR)", async () => {
    const dono = await member();
    const outro = await member();
    const c = await community("ordem-apoio", dono);
    const d = await community("ordem-outra", outro);
    as(dono);
    const ids: number[] = [];
    for (const name of ["Alfa", "Beta", "Gama"]) ids.push((await (await add(c.slug, { name, kind: "outro" })).json()).supporter.id);
    as(outro);
    const alheio = (await (await add(d.slug, { name: "Delta", kind: "outro" })).json()).supporter.id as number;

    const { PATCH } = await routes.supporters();
    // dono da outra comunidade não mexe nesta
    expect((await PATCH(req("PATCH", { order: [ids[2], ids[1], ids[0]] }), ctx(c.slug))).status).toBe(403);
    as(dono);
    const r = await PATCH(req("PATCH", { order: [ids[2], ids[0], ids[1]] }), ctx(c.slug));
    expect(r.status).toBe(200);
    expect((await r.json()).supporters.map((s: { name: string }) => s.name)).toEqual(["Gama", "Alfa", "Beta"]);
    expect((await PATCH(req("PATCH", { order: [ids[0], ids[1]] }), ctx(c.slug))).status).toBe(400);
    expect((await PATCH(req("PATCH", { order: [ids[0], ids[0], ids[1]] }), ctx(c.slug))).status).toBe(400);
    expect((await PATCH(req("PATCH", { order: [ids[0], ids[1], alheio] }), ctx(c.slug))).status).toBe(400);
    expect((await PATCH(req("PATCH", { order: "1,2" }), ctx(c.slug))).status).toBe(400);
    expect((await listSupporters(c.id)).map((s) => s.name)).toEqual(["Gama", "Alfa", "Beta"]);
    expect((await listSupporters(d.id)).map((s) => s.position)).toEqual([1]);
  });

  it("remove só o desta comunidade", async () => {
    const dono = await member();
    const outro = await member();
    const c = await community("remove-apoio", dono);
    const d = await community("remove-outra", outro);
    as(outro);
    const alheio = (await (await add(d.slug, { name: "Delta", kind: "outro" })).json()).supporter.id as number;
    as(dono);
    const meu = (await (await add(c.slug, { name: "Alfa", kind: "outro" })).json()).supporter.id as number;
    const { DELETE } = await routes.supporters();
    expect((await DELETE(req("DELETE", { id: alheio }), ctx(c.slug))).status).toBe(404);
    expect((await DELETE(req("DELETE", { id: "x" }), ctx(c.slug))).status).toBe(400);
    expect((await DELETE(req("DELETE", { id: meu }), ctx(c.slug))).status).toBe(200);
    expect(await listSupporters(c.id)).toEqual([]);
    expect(await listSupporters(d.id)).toHaveLength(1);
  });

  it("rate limit nas escritas: 60 por hora por membro", async () => {
    const dono = await member();
    const c = await community("rate-apoio", dono);
    as(dono);
    const { DELETE } = await routes.supporters();
    for (let i = 0; i < 60; i++) expect((await DELETE(req("DELETE", { id: 999999 }), ctx(c.slug))).status).toBe(404);
    const r = await DELETE(req("DELETE", { id: 999999 }), ctx(c.slug));
    expect(r.status).toBe(429);
    expect(r.headers.get("Retry-After")).toBeTruthy();
  });

  it("apagar a comunidade leva os apoiadores e os pedidos junto", async () => {
    const dono = await member();
    const c = await community("cascata-apoio", dono);
    as(dono);
    await add(c.slug, { name: "Alfa", kind: "outro" });
    const { POST } = await routes.leads();
    as(null);
    expect((await POST(req("POST", { company: "Acme", email: "a@acme.dev", community: c.slug }))).status).toBe(201);
    await db.prepare("DELETE FROM communities WHERE id = ?").run(c.id);
    expect(await listSupporters(c.id)).toEqual([]);
    expect(await countCommunityLeads(c.id)).toBe(0);
  });
});

describe("quero apoiar esta comunidade — POST /api/leads com community", () => {
  it("anon cria lead ligado à comunidade e avisa dono e organizadores (não membro comum)", async () => {
    const dono = await member();
    const org = await member();
    const comum = await member();
    const admin = await member("admin");
    const c = await community("lead-apoio", dono);
    await addRole(c.id, org, "organizador");
    await addRole(c.id, comum, "membro");
    const { POST } = await routes.leads();
    const res = await POST(
      req("POST", {
        company: "Padaria do Centro",
        email: "Contato@Padaria.com.br",
        community: c.slug,
        supportKind: "comida",
        message: "pão de queijo pro hackathon",
        // interesse vindo do cliente é ignorado: apoio é sempre 'comunidade'
        interest: "desafio",
      }),
    );
    expect(res.status).toBe(201);
    const { lead } = await res.json();
    expect(lead).toMatchObject({
      company: "Padaria do Centro",
      email: "contato@padaria.com.br",
      interest: "comunidade",
      communityId: c.id,
      supportKind: "comida",
      message: "pão de queijo pro hackathon",
    });
    const expected = [
      { type: "community_support", text: `Padaria do Centro quer apoiar a comunidade Comunidade ${c.slug} (comida).`, href: `/comunidade/${c.slug}/apoio#pedidos` },
    ];
    expect(await notes(dono.id)).toEqual(expected);
    expect(await notes(org.id)).toEqual(expected);
    expect(await notes(comum.id)).toEqual([]);
    expect(await notes(admin.id)).toEqual([]);
    // fila do painel da comunidade, fora da fila do /admin
    expect((await listCommunityLeads(c.id)).map((l) => l.company)).toEqual(["Padaria do Centro"]);
    expect((await listLeads()).some((l) => l.communityId === c.id)).toBe(false);
  });

  it("comunidade sem dono (como a Hack Inova) avisa os admins", async () => {
    const admin = await member("admin");
    const c = await community("sem-dono-apoio", null);
    const { POST } = await routes.leads();
    expect((await POST(req("POST", { company: "Acme", email: "x@acme.dev", community: c.slug }))).status).toBe(201);
    expect(await notes(admin.id)).toEqual([
      { type: "community_support", text: `Acme quer apoiar a comunidade Comunidade ${c.slug}.`, href: `/comunidade/${c.slug}/apoio#pedidos` },
    ]);
  });

  it("dedupe por comunidade: mesma empresa na mesma é 200; em outra é lead novo", async () => {
    const a = await community("dedupe-a", await member());
    const b = await community("dedupe-b", await member());
    const { POST } = await routes.leads();
    const body = { company: "Acme", email: "d@acme.dev", community: a.slug };
    expect((await POST(req("POST", body))).status).toBe(201);
    const again = await POST(req("POST", body));
    expect(again.status).toBe(200);
    expect((await again.json()).deduped).toBe(true);
    expect((await POST(req("POST", { ...body, community: b.slug }))).status).toBe(201);
    // e o lead da plataforma com a mesma empresa também é outro
    expect((await POST(req("POST", { company: "Acme", email: "d@acme.dev", interest: "desafio" }))).status).toBe(201);
    expect(await countCommunityLeads(a.id)).toBe(1);
    expect(await countCommunityLeads(b.id)).toBe(1);
  });

  it("valida: comunidade inexistente/escondida 404, tipo fora da lista, mensagem longa, comunidade sem slug", async () => {
    const hidden = await community("escondida-lead", await member(), { hidden: 1 });
    const ok = await community("valida-lead", await member());
    const { POST } = await routes.leads();
    const base = { company: "Acme", email: "v@acme.dev" };
    expect((await POST(req("POST", { ...base, community: "nao-existe" }))).status).toBe(404);
    expect((await POST(req("POST", { ...base, community: hidden.slug }))).status).toBe(404);
    expect((await POST(req("POST", { ...base, community: ok.slug, supportKind: "alcance" }))).status).toBe(400);
    expect((await POST(req("POST", { ...base, community: ok.slug, message: "x".repeat(1001) }))).status).toBe(400);
    expect((await POST(req("POST", { ...base, community: 42 }))).status).toBe(400);
    expect((await POST(req("POST", { ...base, interest: "comunidade" }))).status).toBe(400);
    expect((await POST(req("POST", { ...base, community: ok.slug, email: "nope" }))).status).toBe(400);
    // tamanho: empresa e e-mail no limite dos formulários
    expect((await POST(req("POST", { ...base, community: ok.slug, company: "x".repeat(121) }))).status).toBe(400);
    expect((await POST(req("POST", { ...base, community: ok.slug, email: `${"a".repeat(195)}@x.dev` }))).status).toBe(400);
    // e-mail que vira mailto com bcc/subject escondido
    const inj = await POST(req("POST", { ...base, community: ok.slug, email: "contato@empresa.com?bcc=espiao%40evil.com&subject=Proposta" }));
    expect(inj.status).toBe(400);
    expect(await inj.json()).toEqual({ error: "e-mail inválido" });
    expect(await countCommunityLeads(ok.id)).toBe(0);
  });

  it("sem tipo escolhido grava null (nada inventado) e o aviso não cita tipo", async () => {
    const dono = await member();
    const c = await community("sem-tipo-lead", dono);
    const { POST } = await routes.leads();
    for (const supportKind of [undefined, null]) {
      const r = await POST(req("POST", { company: `Banco ${String(supportKind)}`, email: "b@banco.dev", community: c.slug, supportKind }));
      expect(r.status).toBe(201);
      expect((await r.json()).lead.supportKind).toBeNull();
    }
    // string vazia (select sem escolha mandado cru) é recusada, não vira tipo
    expect((await POST(req("POST", { company: "Banco vazio", email: "b@banco.dev", community: c.slug, supportKind: "" }))).status).toBe(400);
    expect((await notes(dono.id)).map((n) => n.text)).toEqual([
      `Banco undefined quer apoiar a comunidade Comunidade ${c.slug}.`,
      `Banco null quer apoiar a comunidade Comunidade ${c.slug}.`,
    ]);
  });

  it("limites valem pra lead da plataforma também", async () => {
    const { POST } = await routes.leads();
    const base = { company: "Acme", email: "p@acme.dev", interest: "desafio" };
    expect((await POST(req("POST", { ...base, message: "x".repeat(1001) }))).status).toBe(400);
    expect((await POST(req("POST", { ...base, company: "x".repeat(121) }))).status).toBe(400);
    expect((await POST(req("POST", { ...base, message: "x".repeat(1000), company: "x".repeat(120) }))).status).toBe(201);
  });

  it("honeypot: 201 silencioso, nada grava, ninguém é avisado", async () => {
    const dono = await member();
    const c = await community("honeypot-apoio", dono);
    const { POST } = await routes.leads();
    const r = await POST(req("POST", { company: "Bot", email: "b@bot.dev", community: c.slug, website: "https://spam.dev" }));
    expect(r.status).toBe(201);
    expect(await countCommunityLeads(c.id)).toBe(0);
    expect(await notes(dono.id)).toEqual([]);
  });

  it("rate limit do /api/leads vale aqui: 5 por hora por IP", async () => {
    const c = await community("rate-lead", await member());
    const { POST } = await routes.leads();
    const ip = "10.250.0.1";
    for (let i = 0; i < 5; i++) {
      expect((await POST(req("POST", { company: `Acme ${i}`, email: `r${i}@acme.dev`, community: c.slug }, ip))).status).toBe(201);
    }
    const blocked = await POST(req("POST", { company: "Acme 6", email: "r6@acme.dev", community: c.slug }, ip));
    expect(blocked.status).toBe(429);
    expect(await countCommunityLeads(c.id)).toBe(5);
  });
});
