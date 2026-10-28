import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { block, mute } from "@/lib/blocks";
import { deleteMemberData } from "@/lib/privacy";
import { resetRateLimits } from "@/lib/ratelimit";
import {
  excerpt,
  parseCursor,
  parseSearchQuery,
  SEARCH_DOC,
  SEARCH_TYPES,
  searchAll,
  searchWords,
  toLikePattern,
} from "@/lib/search";

// Busca global (migration 042): dicionário 'portuguese' no PGlite, índice
// usado de verdade, cada tipo, o que nunca aparece (escondido, bloqueado,
// excluído, fora do ar, projeto que o /projetos não mostra), limites e a
// rota /api/search (401, 400, 429, paginação).

const clerk = vi.hoisted(() => ({ uid: null as string | null }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: clerk.uid })),
  currentUser: vi.fn(async () => null),
}));

let seq = 0;
type M = { id: number; clerkId: string; username: string };
async function member(fields: { username?: string; name?: string; headline?: string; bio?: string } = {}): Promise<M> {
  const tag = `bs${seq++}`;
  const username = fields.username ?? `u_${tag}`;
  const row = await db
    .prepare("INSERT INTO members (clerkId, username, email, name, headline, bio) VALUES (?, ?, ?, ?, ?, ?) RETURNING id")
    .get<{ id: number }>(`clerk_${tag}`, username, `${tag}@t.dev`, fields.name ?? `Pessoa ${tag}`, fields.headline ?? null, fields.bio ?? null);
  return { id: row!.id, clerkId: `clerk_${tag}`, username };
}
async function community(name: string, description: string, hidden = 0) {
  const slug = `c-${seq++}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 20)}`.replace(/-+$/, "");
  const r = await db
    .prepare("INSERT INTO communities (slug, name, description, hidden) VALUES (?, ?, ?, ?) RETURNING id")
    .get<{ id: number }>(slug, name, description, hidden);
  return { id: r!.id, slug };
}
async function hackathon(name: string, o: { active?: number; communityId?: number | null; description?: string; deadline?: string | null } = {}) {
  const id = `h-busca-${seq++}`;
  await db
    .prepare(
      `INSERT INTO hackathons (id, name, organizer, startsAt, format, registrationUrl, active, communityId, description, submissionDeadline, source)
       VALUES (?, ?, 'Org Teste', '2026-12-01 09:00:00', 'presencial', 'https://exemplo.dev', ?, ?, ?, ?, 'painel')`,
    )
    .run(id, name, o.active ?? 1, o.communityId ?? null, o.description ?? null, o.deadline ?? null);
  return id;
}
async function project(hackathonId: string, title: string, description: string, tagline: string | null = null) {
  const t = await db
    .prepare("INSERT INTO teams (hackathonId, name) VALUES (?, ?) RETURNING id")
    .get<{ id: number }>(hackathonId, `Time ${seq++}`);
  await db
    .prepare("INSERT INTO team_projects (teamId, title, description, tagline) VALUES (?, ?, ?, ?)")
    .run(t!.id, title, description, tagline);
  return t!.id;
}
async function post(by: number, body: string, o: { communityId?: number | null; hackathonId?: string | null } = {}) {
  const r = await db
    .prepare("INSERT INTO posts (memberId, body, communityId, hackathonId) VALUES (?, ?, ?, ?) RETURNING id")
    .get<{ id: number }>(by, body, o.communityId ?? null, o.hackathonId ?? null);
  return r!.id;
}
const as = (m: { clerkId: string } | null) => {
  clerk.uid = m?.clerkId ?? null;
};
const route = () => import("@/app/api/search/route");
const get = async (qs: string) => (await route()).GET(new Request(`http://t/api/search?${qs}`));

beforeEach(() => {
  resetRateLimits();
  as(null);
});

describe("dicionário e índice", () => {
  it("o PGlite tem o 'portuguese' (antes da migration usar)", async () => {
    const r = await db.prepare("SELECT to_tsvector('portuguese', 'projetos')::text AS v").get<{ v: string }>();
    expect(r?.v).toBe("'projet':1");
  });

  it("toda consulta usa o índice GIN da migration 042 (expressão idêntica)", async () => {
    const cases: [string, string, string][] = [
      ["posts p", SEARCH_DOC.posts("p"), "idx_posts_fts"],
      ["team_projects tp", SEARCH_DOC.projetos("tp"), "idx_team_projects_fts"],
      ["members m", SEARCH_DOC.pessoas("m"), "idx_members_fts"],
      ["communities co", SEARCH_DOC.comunidades("co"), "idx_communities_fts"],
      ["hackathons h", SEARCH_DOC.hackathons("h"), "idx_hackathons_fts"],
    ];
    await db.exec("SET enable_seqscan = off");
    try {
      for (const [from, doc, idx] of cases) {
        const plan = await db
          .prepare(`EXPLAIN SELECT 1 FROM ${from} WHERE ${doc} @@ websearch_to_tsquery('portuguese', 'saúde')`)
          .all<{ "QUERY PLAN": string }>();
        expect(plan.map((r) => r["QUERY PLAN"]).join("\n"), from).toContain(idx);
      }
    } finally {
      await db.exec("RESET enable_seqscan");
    }
  });
});

describe("funções puras", () => {
  it("parseSearchQuery: 2 a 80 caracteres depois do trim", () => {
    expect(parseSearchQuery("a")).toMatchObject({ ok: false });
    expect(parseSearchQuery("   a  ")).toMatchObject({ ok: false });
    expect(parseSearchQuery(null)).toMatchObject({ ok: false });
    expect(parseSearchQuery("ab")).toEqual({ ok: true, q: "ab" });
    expect(parseSearchQuery("  projeto   de  saúde ")).toEqual({ ok: true, q: "projeto de saúde" });
    expect(parseSearchQuery("x".repeat(80))).toMatchObject({ ok: true });
    expect(parseSearchQuery("x".repeat(81))).toMatchObject({ ok: false });
  });

  it("toLikePattern segue escapando curinga", () => {
    expect(toLikePattern("50%_a")).toBe("%50\\%\\_a%");
    expect(toLikePattern("  ")).toBeNull();
  });

  it("searchWords e cursor", () => {
    expect(searchWords("Projeto de SAÚDE, saúde! a")).toEqual(["projeto", "de", "saúde"]);
    expect(parseCursor("a20")).toEqual({ mode: "a", offset: 20 });
    expect(parseCursor("o5")).toEqual({ mode: "o", offset: 5 });
    expect(parseCursor("x1")).toBeNull();
    expect(parseCursor("a-1")).toBeNull();
    expect(parseCursor(null)).toBeNull();
  });

  it("excerpt: texto curto inteiro, longo com até 160 em volta da palavra", () => {
    expect(excerpt("curto  e\n direto", "direto")).toBe("curto e direto");
    const long = `${"começo do texto bem comprido ".repeat(8)}aqui fala de saúde mental no meio ${"e segue falando de outra coisa ".repeat(8)}`;
    const e = excerpt(long, "saude");
    expect([...e].length).toBeLessThanOrEqual(160);
    expect(e).toContain("saúde");
    expect(e.startsWith("…")).toBe(true);
    expect(e.endsWith("…")).toBe(true);
    const head = excerpt(long, "nada-a-ver");
    expect(head.startsWith("começo")).toBe(true);
    expect([...head].length).toBeLessThanOrEqual(160);
  });
});

describe("searchAll por tipo", () => {
  it("'projeto de saúde' acha projeto com 'saúde' só na descrição", async () => {
    const me = await member();
    const h = await hackathon("Hack Busca Saúde Um");
    const teamId = await project(h, "Calma", "Um app de saúde mental pra estudante.");
    await project(h, "Outra coisa", "Ferramenta de logística.");
    const r = await searchAll("projeto de saúde", me.id);
    expect(r.sections.projetos?.items.map((p) => p.teamId)).toContain(teamId);
    expect(r.sections.projetos?.items.find((p) => p.title === "Outra coisa")).toBeUndefined();
    const hit = r.sections.projetos!.items.find((p) => p.teamId === teamId)!;
    expect(hit).toMatchObject({ title: "Calma", hackathonId: h, hackathonName: "Hack Busca Saúde Um" });
  });

  it("todas as palavras vêm antes; plural e acento resolvem pelo dicionário", async () => {
    const me = await member();
    const h = await hackathon("Hack Busca Dois");
    const both = await project(h, "Projetos de saúde", "monitor de projetos");
    const r = await searchAll("projeto saúde", me.id, { tipo: "projetos" });
    expect(r.sections.projetos?.items[0]?.teamId).toBe(both);
  });

  it("pessoa achada pelo começo do @ (com ou sem @) e pelo nome", async () => {
    const me = await member();
    const ana = await member({ username: "anabeatrizdev", name: "Ana Beatriz", headline: "front-end e acessibilidade" });
    for (const q of ["anab", "@anabea", "an"]) {
      const r = await searchAll(q, me.id, { tipo: "pessoas" });
      expect(r.sections.pessoas?.items.map((p) => p.username), q).toContain("anabeatrizdev");
    }
    const byName = await searchAll("Beatriz", me.id);
    expect(byName.sections.pessoas?.items[0]).toMatchObject({ id: ana.id, name: "Ana Beatriz", headline: "front-end e acessibilidade" });
    const byHeadline = await searchAll("acessibilidade", me.id);
    expect(byHeadline.sections.pessoas?.items.map((p) => p.id)).toContain(ana.id);
    // curinga do usuário é literal
    const wild = await searchAll("a%", me.id, { tipo: "pessoas" });
    expect(wild.sections.pessoas?.items.map((p) => p.id)).not.toContain(ana.id);
  });

  it("post vira trecho de até 160 com autor e lugar", async () => {
    const me = await member();
    const autor = await member({ username: "autorposts" });
    const c = await community("Comunidade Trecho", "de tudo");
    const body = `${"Bom dia pessoal, ".repeat(10)}alguém conhece kubernetes pra hackathon? ${"Valeu demais galera. ".repeat(10)}`;
    const id = await post(autor.id, body, { communityId: c.id });
    const r = await searchAll("kubernetes", me.id);
    const hit = r.sections.posts?.items.find((p) => p.id === id);
    expect(hit).toBeDefined();
    expect([...hit!.excerpt].length).toBeLessThanOrEqual(160);
    expect(hit!.excerpt).toContain("kubernetes");
    expect(hit).toMatchObject({ username: "autorposts", communityName: "Comunidade Trecho", communitySlug: c.slug });
    expect(hit).not.toHaveProperty("body");
  });

  it("comunidade e hackathon por nome e descrição", async () => {
    const me = await member();
    const c = await community("Robótica Livre Campinas", "Encontros de robótica e eletrônica");
    const h = await hackathon("Hackathon de Agronegócio", { description: "Soluções pro campo", communityId: c.id });
    const r = await searchAll("robótica", me.id);
    expect(r.sections.comunidades?.items[0]).toMatchObject({ slug: c.slug, name: "Robótica Livre Campinas", verified: false, online: false });
    const r2 = await searchAll("agronegócio", me.id);
    expect(r2.sections.hackathons?.items[0]).toMatchObject({ id: h, name: "Hackathon de Agronegócio", hosted: true });
    const r3 = await searchAll("campo", me.id, { tipo: "hackathons" });
    expect(r3.sections.hackathons?.items.map((x) => x.id)).toContain(h);
  });
});

describe("o que nunca aparece", () => {
  it("comunidade escondida, os posts dela e os hackathons dela somem", async () => {
    const me = await member();
    const autor = await member();
    const hid = await community("Xilofone Escondido", "xilofonistas", 1);
    const vis = await community("Xilofone Aberto", "xilofonistas");
    await post(autor.id, "xilofone no mural escondido", { communityId: hid.id });
    const okPost = await post(autor.id, "xilofone no mural aberto", { communityId: vis.id });
    const hh = await hackathon("Xilofone Hack Escondido", { communityId: hid.id });
    const hv = await hackathon("Xilofone Hack Aberto", { communityId: vis.id });
    const r = await searchAll("xilofone", me.id, {});
    expect(r.sections.comunidades?.items.map((c) => c.slug)).toEqual([vis.slug]);
    expect(r.sections.posts?.items.map((p) => p.id)).toEqual([okPost]);
    expect(r.sections.hackathons?.items.map((h) => h.id)).toEqual([hv]);
    expect(r.sections.hackathons?.items.map((h) => h.id)).not.toContain(hh);
  });

  it("hackathon fora do ar (active = 0) e post de rascunho somem", async () => {
    const me = await member();
    const off = await hackathon("Zabumba Rascunho", { active: 0 });
    const on = await hackathon("Zabumba No Ar");
    await post(me.id, "zabumba no mural do rascunho", { hackathonId: off });
    const r = await searchAll("zabumba", me.id);
    expect(r.sections.hackathons?.items.map((h) => h.id)).toEqual([on]);
    expect(r.sections.posts?.items).toEqual([]);
  });

  it("pessoa bloqueada (nos dois sentidos) some; silenciada some só dos posts", async () => {
    const me = await member();
    const bloqueei = await member({ username: "ocarina_um", name: "Ocarina Um" });
    const meBloqueou = await member({ username: "ocarina_dois", name: "Ocarina Dois" });
    const silenciei = await member({ username: "ocarina_tres", name: "Ocarina Tres" });
    await block(me.id, bloqueei.id);
    await block(meBloqueou.id, me.id);
    await mute(me.id, silenciei.id);
    for (const m of [bloqueei, meBloqueou, silenciei]) await post(m.id, `ocarina post de ${m.username}`);
    const r = await searchAll("ocarina", me.id);
    expect(r.sections.pessoas?.items.map((p) => p.username)).toEqual(["ocarina_tres"]);
    expect(r.sections.posts?.items).toEqual([]);
    // quem não tem relação nenhuma vê todo mundo
    const other = await member();
    const r2 = await searchAll("ocarina", other.id, { tipo: "pessoas" });
    expect(r2.sections.pessoas?.items).toHaveLength(3);
  });

  it("conta excluída some", async () => {
    const me = await member();
    const saiu = await member({ username: "berimbau_saiu", name: "Berimbau Saiu" });
    await post(saiu.id, "berimbau é bom");
    await deleteMemberData(saiu.id);
    const r = await searchAll("berimbau", me.id);
    expect(r.sections.pessoas?.items).toEqual([]);
    expect(r.sections.posts?.items).toEqual([]);
  });

  it("projeto que o /projetos não mostra (prazo ainda aberto) não aparece", async () => {
    const me = await member();
    const aberto = await hackathon("Edição Prazo Aberto", { deadline: "2099-01-01 00:00:00" });
    await project(aberto, "Pandeiro Secreto", "pandeiro em andamento");
    const livre = await hackathon("Edição Sem Prazo");
    const ok = await project(livre, "Pandeiro Público", "pandeiro entregue");
    const r = await searchAll("pandeiro", me.id, { tipo: "projetos" });
    expect(r.sections.projetos?.items.map((p) => p.teamId)).toEqual([ok]);
  });
});

describe("limites e paginação", () => {
  it("sem tipo: 5 por seção e next; com tipo: 20 por página e cursor", async () => {
    const me = await member();
    for (let i = 0; i < 26; i++) await community(`Cuíca ${i}`, "comunidade de cuíca");
    const all = await searchAll("cuíca", me.id);
    expect(Object.keys(all.sections).sort()).toEqual([...SEARCH_TYPES].sort());
    expect(all.sections.comunidades?.items).toHaveLength(5);
    expect(all.sections.comunidades?.next).toBeTruthy();
    expect(all.sections.pessoas).toEqual({ items: [], next: null });

    const p1 = await searchAll("cuíca", me.id, { tipo: "comunidades" });
    expect(Object.keys(p1.sections)).toEqual(["comunidades"]);
    expect(p1.sections.comunidades?.items).toHaveLength(20);
    const p2 = await searchAll("cuíca", me.id, { tipo: "comunidades", antes: p1.sections.comunidades!.next });
    expect(p2.sections.comunidades?.items).toHaveLength(6);
    expect(p2.sections.comunidades?.next).toBeNull();
    const ids = new Set([...p1.sections.comunidades!.items, ...p2.sections.comunidades!.items].map((c) => c.id));
    expect(ids.size).toBe(26);
  });

  it("cursor do modo 'qualquer palavra' continua no mesmo modo", async () => {
    const me = await member();
    for (let i = 0; i < 22; i++) await community(`Agogô ${i}`, "comunidade de percussão");
    const p1 = await searchAll("agogô baixo", me.id, { tipo: "comunidades" });
    expect(p1.sections.comunidades?.items).toHaveLength(20);
    expect(p1.sections.comunidades?.next).toMatch(/^o20$/);
    const p2 = await searchAll("agogô baixo", me.id, { tipo: "comunidades", antes: p1.sections.comunidades!.next });
    expect(p2.sections.comunidades?.items).toHaveLength(2);
  });
});

describe("GET /api/search", () => {
  it("401 deslogado", async () => {
    const res = await get("q=teste");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("400 com q de 1 caractere, vazio, acima de 80 ou tipo desconhecido", async () => {
    as(await member());
    for (const qs of ["q=a", "q=", "", `q=${"x".repeat(81)}`, "q=%20a%20", "q=teste&tipo=grupos"]) {
      const res = await get(qs);
      expect(res.status, qs).toBe(400);
      expect((await res.json()).error).toBeTruthy();
    }
  });

  it("200 com as 5 seções; com tipo só ela, e o cursor continua", async () => {
    const me = await member();
    as(me);
    for (let i = 0; i < 21; i++) await community(`Triângulo ${i}`, "forró");
    const res = await get(`q=${encodeURIComponent("triângulo")}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.q).toBe("triângulo");
    expect(body.tipo).toBeNull();
    expect(Object.keys(body.sections).sort()).toEqual([...SEARCH_TYPES].sort());
    expect(body.sections.comunidades.items).toHaveLength(5);

    const t1 = await (await get(`q=${encodeURIComponent("triângulo")}&tipo=comunidades`)).json();
    expect(t1.sections.comunidades.items).toHaveLength(20);
    const t2 = await (await get(`q=${encodeURIComponent("triângulo")}&tipo=comunidades&antes=${t1.sections.comunidades.next}`)).json();
    expect(t2.sections.comunidades.items).toHaveLength(1);
    expect(t2.sections.comunidades.next).toBeNull();
  });

  it("filtra bloqueio de quem pede", async () => {
    const me = await member();
    const b = await member({ username: "sanfona_bloq" });
    await block(b.id, me.id);
    as(me);
    const body = await (await get("q=sanfona_bloq&tipo=pessoas")).json();
    expect(body.sections.pessoas.items).toEqual([]);
  });

  it("429 depois de 120 buscas na hora", async () => {
    as(await member());
    for (let i = 0; i < 120; i++) expect((await get("q=a")).status).toBe(400);
    const res = await get("q=teste");
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });
});
