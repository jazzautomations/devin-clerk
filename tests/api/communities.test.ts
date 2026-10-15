import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { getOpenHackathons } from "@/lib/hackathons";
import { getOrCreateMember } from "@/lib/members";
import { listCommunities, listMyCommunities, nearby } from "@/lib/communities";
import { deleteMemberData, exportMemberData } from "@/lib/privacy";
import { resetRateLimits } from "@/lib/ratelimit";

// Comunidades (migration 027): criar, editar, entrar/sair, papéis, convite
// de organizador, aviso, denúncia, moderação, mural, IDOR entre comunidades
// e LGPD.

const clerk = vi.hoisted(() => ({ uid: null as string | null }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: clerk.uid })),
  currentUser: vi.fn(async () => null),
}));

let seq = 0;
type M = { id: number; clerkId: string; email: string; username: string };
async function member(role = "member", city: string | null = null): Promise<M> {
  const tag = `cm${seq++}`;
  const row = await db
    .prepare("INSERT INTO members (clerkId, username, email, name, role, city) VALUES (?, ?, ?, ?, ?, ?) RETURNING id")
    .get<{ id: number }>(`clerk_${tag}`, `u_${tag}`, `${tag}@t.dev`, `Pessoa ${tag}`, role, city);
  return { id: row!.id, clerkId: `clerk_${tag}`, email: `${tag}@t.dev`, username: `u_${tag}` };
}
const as = (m: { clerkId: string } | null) => {
  clerk.uid = m?.clerkId ?? null;
};
const req = (method: string, body?: unknown) =>
  new Request("http://t", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const ctx = (slug: string) => ({ params: Promise.resolve({ slug }) });

const routes = {
  root: () => import("@/app/api/communities/route"),
  one: () => import("@/app/api/communities/[slug]/route"),
  members: () => import("@/app/api/communities/[slug]/members/route"),
  organizers: () => import("@/app/api/communities/[slug]/organizers/route"),
  notices: () => import("@/app/api/communities/[slug]/notices/route"),
  report: () => import("@/app/api/communities/[slug]/report/route"),
  admin: () => import("@/app/api/admin/communities/[slug]/route"),
  posts: () => import("@/app/api/posts/route"),
};

async function create(owner: M, slug: string, extra: Record<string, unknown> = {}) {
  const { POST } = await routes.root();
  as(owner);
  const res = await POST(req("POST", { name: `Comunidade ${slug}`, slug, city: "Sorocaba, SP", ...extra }));
  expect(res.status, `criar ${slug}`).toBe(201);
  return (await res.json()).community as { id: number; slug: string };
}
const roleOf = async (communityId: number, memberId: number) =>
  (
    await db
      .prepare("SELECT role FROM community_members WHERE communityId = ? AND memberId = ?")
      .get<{ role: string }>(communityId, memberId)
  )?.role ?? null;

beforeEach(() => {
  resetRateLimits();
  as(null);
});

describe("criar comunidade", () => {
  it("401 deslogado; 201 e quem cria vira dono; endereço sai do nome", async () => {
    const { POST } = await routes.root();
    expect((await POST(req("POST", { name: "Hack Club Sorocaba", city: "Sorocaba, SP" }))).status).toBe(401);
    const dono = await member();
    as(dono);
    const res = await POST(req("POST", { name: "Hack Club Sorocaba!", city: "Sorocaba, SP", instagram: "https://instagram.com/hc" }));
    expect(res.status).toBe(201);
    const { community } = await res.json();
    expect(community).toMatchObject({ slug: "hack-club-sorocaba", name: "Hack Club Sorocaba!", createdBy: dono.id, hidden: false, verified: false });
    expect(await roleOf(community.id, dono.id)).toBe("dono");
  });

  it("valida: cidade ou online, endereço, links http(s) e imagem só https", async () => {
    const { POST } = await routes.root();
    as(await member());
    // o limite diário (3) vale antes da validação: zera a cada tentativa
    const bad = async (body: Record<string, unknown>) => {
      resetRateLimits();
      return (await POST(req("POST", body))).status;
    };
    expect(await bad({ name: "Sem Cidade", slug: "sem-cidade" })).toBe(400);
    expect(await bad({ name: "ok", slug: "ok-curto", city: "X" })).toBe(400); // nome < 3
    expect(await bad({ name: "Endereço Ruim", slug: "Com Espaço", city: "X" })).toBe(400);
    expect(await bad({ name: "Reservado", slug: "nova", city: "X" })).toBe(400);
    expect(await bad({ name: "Link Ruim", slug: "link-ruim", city: "X", website: "javascript:alert(1)" })).toBe(400);
    expect(await bad({ name: "Logo Http", slug: "logo-http", city: "X", logoUrl: "http://x.com/a.png" })).toBe(400);
    expect(await bad({ name: "Online Ok", slug: "online-ok", online: true })).toBe(201);
  });

  it("endereço já usado é 409 e a comunidade existente fica intacta", async () => {
    const a = await member();
    await create(a, "dup-comunidade");
    const { POST } = await routes.root();
    as(await member());
    const res = await POST(req("POST", { name: "Outra", slug: "dup-comunidade", city: "X" }));
    expect(res.status).toBe(409);
    expect((await db.prepare("SELECT name FROM communities WHERE slug = 'dup-comunidade'").get<{ name: string }>())?.name).toBe(
      "Comunidade dup-comunidade",
    );
  });

  it("rate limit forte: 3 por dia por membro, a 4ª é 429", async () => {
    const { POST } = await routes.root();
    const m = await member();
    as(m);
    for (let i = 0; i < 3; i++) {
      expect((await POST(req("POST", { name: `Rate ${i} Com`, slug: `rate-${m.id}-${i}`, city: "X" }))).status).toBe(201);
    }
    const r = await POST(req("POST", { name: "Rate 4 Com", slug: `rate-${m.id}-4`, city: "X" }));
    expect(r.status).toBe(429);
    expect(r.headers.get("Retry-After")).toBeTruthy();
  });
});

describe("editar e papéis (IDOR entre comunidades)", () => {
  it("dono e organizador editam; membro, de fora e dono de OUTRA comunidade levam 403; admin edita", async () => {
    const dono = await member();
    const c = await create(dono, "edit-a");
    const outroDono = await member();
    await create(outroDono, "edit-b");
    const org = await member();
    const membro = await member();
    const fora = await member();
    const admin = await member("admin");
    await db.prepare("INSERT INTO community_members (communityId, memberId, role) VALUES (?, ?, 'organizador'), (?, ?, 'membro')").run(c.id, org.id, c.id, membro.id);
    const { PATCH } = await routes.one();
    const patch = async (who: M | null, slug: string, body: Record<string, unknown>) => {
      as(who);
      return (await PATCH(req("PATCH", body), ctx(slug))).status;
    };
    expect(await patch(null, "edit-a", { description: "x" })).toBe(401);
    expect(await patch(membro, "edit-a", { description: "x" })).toBe(403);
    expect(await patch(fora, "edit-a", { description: "x" })).toBe(403);
    expect(await patch(outroDono, "edit-a", { description: "invasão" })).toBe(403);
    expect(await patch(dono, "edit-a", { description: "do dono" })).toBe(200);
    expect(await patch(org, "edit-a", { description: "da organização" })).toBe(200);
    expect(await patch(admin, "edit-a", { description: "do admin" })).toBe(200);
    expect(await patch(dono, "nao-existe", { description: "x" })).toBe(404);
    // endereço, selo e visibilidade não mudam por aqui
    expect(await patch(dono, "edit-a", { slug: "outro" })).toBe(400);
    expect(await patch(dono, "edit-a", { verified: true })).toBe(400);
    expect(await patch(dono, "edit-a", { city: null, online: false })).toBe(400);
    const row = await db.prepare("SELECT description, verified, slug FROM communities WHERE id = ?").get(c.id);
    expect(row).toEqual({ description: "do admin", verified: 0, slug: "edit-a" });
  });
});

describe("entrar e sair", () => {
  it("entrar avisa o dono; entrar de novo é idempotente; sair apaga o vínculo; único dono não sai", async () => {
    const dono = await member();
    const c = await create(dono, "join-a");
    const p = await member();
    const { POST, DELETE } = await routes.members();
    as(null);
    expect((await POST(req("POST"), ctx("join-a"))).status).toBe(401);
    as(p);
    expect((await POST(req("POST"), ctx("join-a"))).status).toBe(201);
    expect((await POST(req("POST"), ctx("join-a"))).status).toBe(200);
    expect(await roleOf(c.id, p.id)).toBe("membro");
    const n = await db
      .prepare("SELECT text, href FROM notifications WHERE memberId = ? AND type = 'community_join'")
      .all<{ text: string; href: string }>(dono.id);
    expect(n).toHaveLength(1);
    expect(n[0].text).toContain(`@${p.username}`);
    expect(n[0].href).toBe("/comunidade/join-a#membros");

    expect((await DELETE(req("DELETE"), ctx("join-a"))).status).toBe(200);
    expect(await roleOf(c.id, p.id)).toBeNull();

    as(dono);
    const r = await DELETE(req("DELETE"), ctx("join-a"));
    expect(r.status).toBe(409);
    expect(await roleOf(c.id, dono.id)).toBe("dono");
    expect((await POST(req("POST"), ctx("nao-existe"))).status).toBe(404);
  });
});

describe("organizadores por convite", () => {
  it("dono chama por e-mail: quem tem conta vira organizador na hora; quem não tem fica pendente e vira no 1º login", async () => {
    const dono = await member();
    const c = await create(dono, "org-a");
    const ja = await member();
    const { POST, DELETE } = await routes.organizers();
    as(dono);
    const r1 = await POST(req("POST", { email: ja.email.toUpperCase() }), ctx("org-a"));
    expect(r1.status).toBe(200);
    expect((await r1.json()).status).toBe("granted");
    expect(await roleOf(c.id, ja.id)).toBe("organizador");

    const r2 = await POST(req("POST", { email: "novata-org@t.dev" }), ctx("org-a"));
    expect(r2.status).toBe(202);
    const novata = await getOrCreateMember({ id: "clerk_novata_org", firstName: "Nova", lastName: null, email: "novata-org@t.dev", imageUrl: null });
    expect(await roleOf(c.id, novata.id)).toBe("organizador");
    expect(await db.prepare("SELECT 1 FROM community_invites WHERE email = 'novata-org@t.dev'").get()).toBeUndefined();

    expect((await POST(req("POST", { email: "não é email" }), ctx("org-a"))).status).toBe(400);
    // tirar o papel: a pessoa continua membro
    expect((await DELETE(req("DELETE", { memberId: ja.id }), ctx("org-a"))).status).toBe(200);
    expect(await roleOf(c.id, ja.id)).toBe("membro");
    expect((await DELETE(req("DELETE", { memberId: ja.id }), ctx("org-a"))).status).toBe(404);
  });

  it("organizador não chama organizador (403) e dono de outra comunidade também não", async () => {
    const dono = await member();
    const c = await create(dono, "org-b");
    const org = await member();
    await db.prepare("INSERT INTO community_members (communityId, memberId, role) VALUES (?, ?, 'organizador')").run(c.id, org.id);
    const outro = await member();
    await create(outro, "org-c");
    const { POST, DELETE } = await routes.organizers();
    as(org);
    expect((await POST(req("POST", { email: "x@t.dev" }), ctx("org-b"))).status).toBe(403);
    as(outro);
    expect((await POST(req("POST", { email: "x@t.dev" }), ctx("org-b"))).status).toBe(403);
    expect((await DELETE(req("DELETE", { memberId: org.id }), ctx("org-b"))).status).toBe(403);
    expect(await roleOf(c.id, org.id)).toBe("organizador");
  });
});

describe("avisos e denúncia", () => {
  it("dono/organizador avisa e cada membro (menos quem escreveu) recebe notificação; membro leva 403", async () => {
    const dono = await member();
    const c = await create(dono, "aviso-a");
    const m1 = await member();
    const m2 = await member();
    const fora = await member();
    for (const m of [m1, m2]) {
      await db.prepare("INSERT INTO community_members (communityId, memberId) VALUES (?, ?)").run(c.id, m.id);
    }
    const { POST } = await routes.notices();
    as(m1);
    expect((await POST(req("POST", { title: "t", body: "b" }), ctx("aviso-a"))).status).toBe(403);
    as(dono);
    expect((await POST(req("POST", { title: "", body: "b" }), ctx("aviso-a"))).status).toBe(400);
    const res = await POST(req("POST", { title: "Encontro sábado", body: "No campus, 14h." }), ctx("aviso-a"));
    expect(res.status).toBe(201);
    expect((await res.json()).notified).toBe(2);
    const who = await db
      .prepare("SELECT memberId FROM notifications WHERE type = 'community_notice' AND href = '/comunidade/aviso-a#avisos' ORDER BY memberId")
      .all<{ memberId: number }>();
    expect(who.map((w) => w.memberId)).toEqual([m1.id, m2.id]);
    expect(who.map((w) => w.memberId)).not.toContain(fora.id);
  });

  it("denúncia de membro logado cai na fila; texto curto é 400; 5 por hora", async () => {
    const dono = await member();
    const c = await create(dono, "denuncia-a");
    const { POST } = await routes.report();
    const p = await member();
    as(p);
    expect((await POST(req("POST", { reason: "x" }), ctx("denuncia-a"))).status).toBe(400);
    for (let i = 0; i < 4; i++) expect((await POST(req("POST", { reason: `spam número ${i}` }), ctx("denuncia-a"))).status).toBe(201);
    expect((await POST(req("POST", { reason: "spam de novo" }), ctx("denuncia-a"))).status).toBe(429);
    expect(Number((await db.prepare("SELECT COUNT(*) n FROM community_reports WHERE communityId = ?").get<{ n: number }>(c.id))?.n)).toBe(4);
  });
});

describe("moderação do admin", () => {
  it("só admin esconde e dá selo; escondida some das listas, da página e os hackathons dela saem do radar", async () => {
    const dono = await member();
    const c = await create(dono, "mod-a");
    await db
      .prepare(
        `INSERT INTO hackathons (id, name, organizer, startsAt, format, registrationUrl, active, source, communityId)
         VALUES ('mod-a-hack', 'Mod Hack', 'Comunidade mod-a', '2099-01-10', 'online', '/h/mod-a-hack', 1, 'painel', ?)`,
      )
      .run(c.id);
    expect((await getOpenHackathons()).some((h) => h.id === "mod-a-hack")).toBe(true);
    const { PATCH } = await routes.admin();
    as(dono);
    expect((await PATCH(req("PATCH", { hidden: true }), ctx("mod-a"))).status).toBe(403);
    const admin = await member("admin");
    as(admin);
    expect((await PATCH(req("PATCH", { hidden: "sim" }), ctx("mod-a"))).status).toBe(400);
    expect((await PATCH(req("PATCH", { verified: true }), ctx("nao-existe"))).status).toBe(404);
    expect((await PATCH(req("PATCH", { hidden: true, verified: true }), ctx("mod-a"))).status).toBe(200);

    expect((await listCommunities()).some((x) => x.slug === "mod-a")).toBe(false);
    expect((await listCommunities({ includeHidden: true })).find((x) => x.slug === "mod-a")).toMatchObject({ hidden: true, verified: true });
    expect((await listMyCommunities(dono.id)).some((x) => x.slug === "mod-a")).toBe(false);
    expect((await getOpenHackathons()).some((h) => h.id === "mod-a-hack")).toBe(false);
    // página e ações: 404 pra quem não é admin, inclusive o dono
    const { GET } = await routes.one();
    as(dono);
    expect((await GET(req("GET"), ctx("mod-a"))).status).toBe(404);
    const { POST } = await routes.members();
    as(await member());
    expect((await POST(req("POST"), ctx("mod-a"))).status).toBe(404);
    as(admin);
    expect((await GET(req("GET"), ctx("mod-a"))).status).toBe(200);
  });
});

describe("mural da comunidade", () => {
  it("só quem está na comunidade posta; GET ?c= traz só o mural dela; feed geral mostra com o nome", async () => {
    const dono = await member();
    const c = await create(dono, "mural-a");
    await create(await member(), "mural-b");
    const { POST, GET } = await routes.posts();
    const fora = await member();
    as(fora);
    expect((await POST(req("POST", { body: "oi", communitySlug: "mural-a" }))).status).toBe(403);
    expect((await POST(req("POST", { body: "oi", communitySlug: "nao-existe" }))).status).toBe(404);
    as(dono);
    const ok = await POST(req("POST", { body: "primeiro encontro", communitySlug: "mural-a" }));
    expect(ok.status).toBe(201);
    expect((await ok.json()).post).toMatchObject({ communityId: c.id, communitySlug: "mural-a", communityName: "Comunidade mural-a" });
    const a = await (await GET(new Request("http://t/api/posts?c=mural-a"))).json();
    expect(a.posts.map((p: { body: string }) => p.body)).toEqual(["primeiro encontro"]);
    const b = await (await GET(new Request("http://t/api/posts?c=mural-b"))).json();
    expect(b.posts).toEqual([]);
  });
});

describe("lista e perto de você", () => {
  it("ordena pela atividade real e acha a mesma cidade, depois o mesmo estado", async () => {
    const d1 = await member();
    const velha = await create(d1, "lista-velha", { city: "Campinas, SP" });
    const nova = await create(await member(), "lista-nova", { city: "Sorocaba, SP" });
    const rj = await create(await member(), "lista-rj", { city: "Niterói, RJ" });
    // datas fixas: o relógio do banco tem resolução de segundo
    const at = async (id: number, when: string) => {
      await db.prepare("UPDATE communities SET createdAt = ? WHERE id = ?").run(when, id);
      await db.prepare("UPDATE community_members SET joinedAt = ? WHERE communityId = ?").run(when, id);
    };
    await at(velha.id, "2020-01-01 00:00:00");
    await at(nova.id, "2024-01-01 00:00:00");
    await at(rj.id, "2023-01-01 00:00:00");
    const list = await listCommunities({ q: "lista-" });
    expect(list.map((x) => x.slug).indexOf("lista-nova")).toBeLessThan(list.map((x) => x.slug).indexOf("lista-velha"));
    // atividade nova na velha (alguém entrou agora) puxa ela pra frente
    await db.prepare("INSERT INTO community_members (communityId, memberId) VALUES (?, ?)").run(velha.id, (await member()).id);
    const again = await listCommunities({ q: "lista-" });
    expect(again[0].slug).toBe("lista-velha");
    expect(again.find((x) => x.slug === "lista-velha")?.members).toBe(2);

    const near = nearby(again, "sorocaba, sp");
    expect(near.map((n) => [n.item.slug, n.match])).toEqual([
      ["lista-nova", "cidade"],
      ["lista-velha", "estado"],
    ]);
    expect(nearby(again, null)).toEqual([]);
  });

  it("GET /api/communities?perto=1 usa a cidade do perfil", async () => {
    await create(await member(), "perto-poa", { city: "Porto Alegre, RS" });
    const { GET } = await routes.root();
    as(null);
    expect((await GET(new Request("http://t/api/communities"))).status).toBe(401);
    as(await member("member", "Porto Alegre, RS"));
    const body = await (await GET(new Request("http://t/api/communities?perto=1"))).json();
    expect(body.communities.map((x: { slug: string }) => x.slug)).toContain("perto-poa");
    expect(body.communities.find((x: { slug: string }) => x.slug === "perto-poa").match).toBe("cidade");
  });
});

describe("LGPD", () => {
  it("export traz o vínculo; excluir a conta do dono apaga o vínculo e a comunidade fica, sem dono", async () => {
    const dono = await member();
    const c = await create(dono, "lgpd-a");
    const data = await exportMemberData(dono.id);
    expect(data!.data["community_members.memberId"]).toEqual([expect.objectContaining({ communityId: c.id, role: "dono" })]);
    await deleteMemberData(dono.id);
    expect(await roleOf(c.id, dono.id)).toBeNull();
    const item = (await listCommunities({ includeHidden: true })).find((x) => x.slug === "lgpd-a");
    expect(item).toMatchObject({ owners: 0, members: 0 });
  });
});
