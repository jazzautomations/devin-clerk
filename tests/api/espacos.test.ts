import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { followCommunity } from "@/lib/follows";
import {
  createSpace,
  getSpaceBySlug,
  listSpaces,
  postIdsBySpace,
  reorderSpaces,
  updateSpace,
  SpaceError,
} from "@/lib/communitySpaces";
import { resetRateLimits } from "@/lib/ratelimit";

// Espaços da comunidade (migration 057): trigger dá os 4 padrão, backfill
// pras antigas, post sem espaço cai no geral, política organizacao só
// deixa a organização postar, até 8 ativos, arquivar esconde mantendo os
// posts e o nono espaço dá 400.

const clerk = vi.hoisted(() => ({ uid: null as string | null }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: clerk.uid })),
  currentUser: vi.fn(async () => null),
}));

const MIGRATION = readFileSync(join(process.cwd(), "migrations/057_espacos.sql"), "utf8");

let seq = 0;
type M = { id: number; clerkId: string; username: string; role: string };
async function member(role = "member"): Promise<M> {
  const tag = `es${seq++}`;
  const row = await db
    .prepare("INSERT INTO members (clerkId, username, email, name, role) VALUES (?, ?, ?, ?, ?) RETURNING id")
    .get<{ id: number }>(`clerk_${tag}`, `u_${tag}`, `${tag}@t.dev`, `Pessoa ${tag}`, role);
  return { id: row!.id, clerkId: `clerk_${tag}`, username: `u_${tag}`, role };
}
async function community(slug: string, dono: M) {
  // o trigger da 057 cria os 4 espaços padrão junto
  const c = await db
    .prepare("INSERT INTO communities (slug, name, description, city) VALUES (?, ?, 'sobre', 'Recife, PE') RETURNING id")
    .get<{ id: number }>(slug, `Comunidade ${slug}`);
  await db.prepare("INSERT INTO community_members (communityId, memberId, role) VALUES (?, ?, 'dono')").run(c!.id, dono.id);
  return { id: c!.id, slug };
}
const joinCommunity = (communityId: number, m: M, role = "membro") =>
  db
    .prepare(
      `INSERT INTO community_members ("communityId", "memberId", role) VALUES (?, ?, ?)
       ON CONFLICT ("communityId", "memberId") DO UPDATE SET role = EXCLUDED.role`,
    )
    .run(communityId, m.id, role);
const as = (m: { clerkId: string } | null) => {
  clerk.uid = m?.clerkId ?? null;
};

const req = (body: unknown, url = "http://t/api/posts") =>
  new Request(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });
const postsRoute = () => import("@/app/api/posts/route");
const spacesRoute = () => import("@/app/api/communities/[slug]/spaces/route");
const spaceRoute = () => import("@/app/api/communities/[slug]/spaces/[spaceId]/route");

beforeEach(() => {
  resetRateLimits();
  as(null);
});

describe("migration 057", () => {
  it("comunidade nova ganha os 4 espaços pelo trigger", async () => {
    const dono = await member();
    const c = await community(`es-trig-${seq}`, dono);
    const spaces = await listSpaces(c.id);
    expect(spaces.map((s) => s.slug)).toEqual(["geral", "ajuda", "vagas", "mostra"]);
    expect(spaces.find((s) => s.slug === "mostra")?.description).toBe("mostra o que você fez");
  });

  it("comunidade antiga ganha os 4 e os posts caem no geral; reexecutar não duplica", async () => {
    const dono = await member();
    const mem = await member();
    const c = await community(`es-old-${seq}`, dono);
    await joinCommunity(c.id, mem);
    // "antiga": sem espaço nenhum e com post de mural sem spaceId
    await db.prepare("DELETE FROM community_spaces WHERE \"communityId\" = ?").run(c.id);
    const post = await db
      .prepare("INSERT INTO posts (memberId, body, communityId) VALUES (?, 'post antigo', ?) RETURNING id")
      .get<{ id: number }>(mem.id, c.id);
    await db.exec(MIGRATION);
    await db.exec(MIGRATION);
    const spaces = await listSpaces(c.id);
    expect(spaces.map((s) => s.slug)).toEqual(["geral", "ajuda", "vagas", "mostra"]);
    const row = await db.prepare("SELECT \"spaceId\" FROM posts WHERE id = ?").get<{ spaceId: number }>(post!.id);
    expect(Number(row!.spaceId)).toBe(spaces[0].id);
  });
});

describe("POST /api/posts com espaço", () => {
  it("sem spaceId o post cai no geral", async () => {
    const dono = await member();
    const c = await community(`es-p1-${seq}`, dono);
    as(dono);
    const { POST } = await postsRoute();
    const res = await POST(req({ body: "oi no mural", communitySlug: c.slug }));
    expect(res.status).toBe(201);
    const { post } = await res.json();
    const geral = await getSpaceBySlug(c.id, "geral");
    const row = await db.prepare("SELECT \"spaceId\" FROM posts WHERE id = ?").get<{ spaceId: number }>(post.id);
    expect(Number(row!.spaceId)).toBe(geral!.id);
  });

  it("com spaceId vai pro espaço; o mural do espaço só lista os dele", async () => {
    const dono = await member();
    const c = await community(`es-p2-${seq}`, dono);
    as(dono);
    const { POST } = await postsRoute();
    const ajuda = (await getSpaceBySlug(c.id, "ajuda"))!;
    const r1 = await POST(req({ body: "socorro com o build", communitySlug: c.slug, spaceId: ajuda.id }));
    expect(r1.status).toBe(201);
    await POST(req({ body: "post do geral", communitySlug: c.slug }));
    const idsAjuda = await postIdsBySpace(ajuda, dono.id);
    const posts = (await import("@/lib/posts")).hydratePosts;
    const hid = await posts(idsAjuda, dono.id);
    expect(hid.map((p) => p.body)).toEqual(["socorro com o build"]);
    // o geral carrega os de spaceId nulo também (porto seguro)
    const geral = (await getSpaceBySlug(c.id, "geral"))!;
    const idsGeral = await postIdsBySpace(geral, dono.id);
    expect((await posts(idsGeral, dono.id)).map((p) => p.body)).toEqual(["post do geral"]);
  });

  it("spaceId de outra comunidade, tipo errado ou sem comunidade: 400", async () => {
    const dono = await member();
    const a = await community(`es-p3a-${seq}`, dono);
    const b = await community(`es-p3b-${seq}`, dono);
    as(dono);
    const { POST } = await postsRoute();
    const deB = (await getSpaceBySlug(b.id, "ajuda"))!;
    expect((await POST(req({ body: "x", communitySlug: a.slug, spaceId: deB.id }))).status).toBe(400);
    expect((await POST(req({ body: "x", communitySlug: a.slug, spaceId: "ajuda" }))).status).toBe(400);
    expect((await POST(req({ body: "x", communitySlug: a.slug, spaceId: 99999 }))).status).toBe(400);
    expect((await POST(req({ body: "x", spaceId: deB.id }))).status).toBe(400);
  });

  it("política organizacao: membro leva 403, organizador posta", async () => {
    const dono = await member();
    const mem = await member();
    const org = await member();
    const c = await community(`es-p4-${seq}`, dono);
    await joinCommunity(c.id, mem);
    await joinCommunity(c.id, org, "organizador");
    const avisos = await createSpace(c.id, { name: "avisos", postPolicy: "organizacao" });
    const { POST } = await postsRoute();
    as(mem);
    expect((await POST(req({ body: "x", communitySlug: c.slug, spaceId: avisos.id }))).status).toBe(403);
    as(org);
    expect((await POST(req({ body: "reunião sábado", communitySlug: c.slug, spaceId: avisos.id }))).status).toBe(201);
  });

  it("espaço arquivado não aceita post (400) e some do seletor", async () => {
    const dono = await member();
    const c = await community(`es-p5-${seq}`, dono);
    const extra = await createSpace(c.id, { name: "projetos" });
    await updateSpace(c.id, extra.id, { archived: true });
    as(dono);
    const { POST } = await postsRoute();
    expect((await POST(req({ body: "x", communitySlug: c.slug, spaceId: extra.id }))).status).toBe(400);
    // seletor (GET spaces) não mostra arquivado
    const { GET } = await spacesRoute();
    const res = await GET(new Request("http://t/x"), ctx({ slug: c.slug }));
    const { spaces } = await res.json();
    expect(spaces.map((s: { slug: string }) => s.slug)).not.toContain("projetos");
  });

  it("quem só segue a comunidade continua sem postar (403)", async () => {
    const dono = await member();
    const seguidor = await member();
    const c = await community(`es-p6-${seq}`, dono);
    await followCommunity(c.id, seguidor.id);
    as(seguidor);
    const { POST } = await postsRoute();
    const ajuda = (await getSpaceBySlug(c.id, "ajuda"))!;
    expect((await POST(req({ body: "x", communitySlug: c.slug, spaceId: ajuda.id }))).status).toBe(403);
  });
});

describe("gestão de espaços", () => {
  it("cria até 8 ativos; o nono dá 400", async () => {
    const dono = await member();
    const c = await community(`es-g1-${seq}`, dono); // já nasce com 4
    as(dono);
    const { POST } = await spacesRoute();
    for (const n of ["projetos", "links", "off", "duvidas-gerais"]) {
      const res = await POST(req({ name: n }, `http://t/api/communities/${c.slug}/spaces`), ctx({ slug: c.slug }));
      expect(res.status).toBe(201);
    }
    const nono = await POST(req({ name: "nono" }, `http://t/api/communities/${c.slug}/spaces`), ctx({ slug: c.slug }));
    expect(nono.status).toBe(400);
  });

  it("nome repetido, membro criando e deslogado", async () => {
    const dono = await member();
    const mem = await member();
    const c = await community(`es-g2-${seq}`, dono);
    await joinCommunity(c.id, mem);
    const { POST } = await spacesRoute();
    as(dono);
    expect((await POST(req({ name: "ajuda" }, `http://t/api/communities/${c.slug}/spaces`), ctx({ slug: c.slug }))).status).toBe(400);
    as(mem);
    expect((await POST(req({ name: "projetos" }, `http://t/api/communities/${c.slug}/spaces`), ctx({ slug: c.slug }))).status).toBe(403);
    as(null);
    expect((await POST(req({ name: "projetos" }, `http://t/api/communities/${c.slug}/spaces`), ctx({ slug: c.slug }))).status).toBe(401);
  });

  it("renomear, ordenar com a lista inteira e arquivar; geral não arquiva", async () => {
    const dono = await member();
    const c = await community(`es-g3-${seq}`, dono);
    const spaces = await listSpaces(c.id);
    const [geral, ajuda, vagas, mostra] = spaces;
    // renomear mantém o slug
    const renamed = await updateSpace(c.id, ajuda.id, { name: "ajuda geral", description: "peça uma mão" });
    expect(renamed.slug).toBe("ajuda");
    expect(renamed.name).toBe("ajuda geral");
    // ordenar exige a lista completa
    await expect(reorderSpaces(c.id, [mostra.id, geral.id])).rejects.toThrow(SpaceError);
    const reordered = await reorderSpaces(c.id, [mostra.id, vagas.id, ajuda.id, geral.id]);
    expect(reordered.map((s) => s.slug)).toEqual(["mostra", "vagas", "ajuda", "geral"]);
    // geral não é arquivável; os outros sim, e voltam
    await expect(updateSpace(c.id, geral.id, { archived: true })).rejects.toThrow(/não dá pra arquivar/);
    const archived = await updateSpace(c.id, vagas.id, { archived: true });
    expect(archived.archivedAt).not.toBeNull();
    expect((await listSpaces(c.id)).map((s) => s.slug)).not.toContain("vagas");
    const back = await updateSpace(c.id, vagas.id, { archived: false });
    expect(back.archivedAt).toBeNull();
  });

  it("PATCH do espaço: 404 fora da comunidade e em espaço de outra", async () => {
    const dono = await member();
    const a = await community(`es-g4a-${seq}`, dono);
    const b = await community(`es-g4b-${seq}`, dono);
    as(dono);
    const { PATCH } = await spaceRoute();
    const deB = (await getSpaceBySlug(b.id, "ajuda"))!;
    const res = await PATCH(req({ name: "x" }, "http://t/x"), ctx({ slug: a.slug, spaceId: String(deB.id) }));
    expect(res.status).toBe(404);
    expect((await PATCH(req({ name: "x" }, "http://t/x"), ctx({ slug: a.slug, spaceId: "9999" }))).status).toBe(404);
    // rename vale
    const ajuda = (await getSpaceBySlug(a.id, "ajuda"))!;
    const ok = await PATCH(req({ name: "central de ajuda" }, "http://t/x"), ctx({ slug: a.slug, spaceId: String(ajuda.id) }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).space.name).toBe("central de ajuda");
  });

  it("GET /api/posts?c=&s= filtra por espaço e 404 no arquivado", async () => {
    const dono = await member();
    const c = await community(`es-g5-${seq}`, dono);
    const ajuda = (await getSpaceBySlug(c.id, "ajuda"))!;
    const vagas = (await getSpaceBySlug(c.id, "vagas"))!;
    await db.prepare("INSERT INTO posts (memberId, body, communityId, \"spaceId\") VALUES (?, 'dúvida', ?, ?)").run(dono.id, c.id, ajuda.id);
    await db.prepare("INSERT INTO posts (memberId, body, communityId, \"spaceId\") VALUES (?, 'vaga', ?, ?)").run(dono.id, c.id, vagas.id);
    const { GET } = await postsRoute();
    const res = await GET(new Request(`http://t/api/posts?c=${c.slug}&s=ajuda`));
    const { posts } = await res.json();
    expect(posts.map((p: { body: string }) => p.body)).toEqual(["dúvida"]);
    await updateSpace(c.id, vagas.id, { archived: true });
    expect((await GET(new Request(`http://t/api/posts?c=${c.slug}&s=vagas`))).status).toBe(404);
  });
});
