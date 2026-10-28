import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { isBlockedEither } from "@/lib/blocks";
import { listCommunities, reportCommunity, setModeration } from "@/lib/communities";
import { deleteMemberData, exportMemberData } from "@/lib/privacy";
import { resetRateLimits } from "@/lib/ratelimit";
import { canHandleReport, createReport, getReport, listReports, countOpenByType, ReportError } from "@/lib/reports";

// Denúncia numa fila só (migration 032): rota (401/400/404/409/429),
// roteamento (comunidade, edição, admin), incidente em edição rolando,
// quem pode ler e resolver, "denunciar já bloqueia", migração das denúncias
// de comunidade (027) e LGPD (autor some, denúncia fica).

const clerk = vi.hoisted(() => ({ uid: null as string | null }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: clerk.uid })),
  currentUser: vi.fn(async () => null),
}));

let seq = 0;
type M = { id: number; clerkId: string; username: string; role: string };
async function member(role = "member"): Promise<M> {
  const tag = `dn${seq++}`;
  const row = await db
    .prepare("INSERT INTO members (clerkId, username, email, name, role) VALUES (?, ?, ?, ?, ?) RETURNING id")
    .get<{ id: number }>(`clerk_${tag}`, `u_${tag}`, `${tag}@t.dev`, `Pessoa ${tag}`, role);
  return { id: row!.id, clerkId: `clerk_${tag}`, username: `u_${tag}`, role };
}
async function community(slug: string, dono: M) {
  const c = await db
    .prepare("INSERT INTO communities (slug, name, description) VALUES (?, ?, 'sobre') RETURNING id")
    .get<{ id: number }>(slug, `Comunidade ${slug}`);
  await db.prepare("INSERT INTO community_members (communityId, memberId, role) VALUES (?, ?, 'dono')").run(c!.id, dono.id);
  return { id: c!.id, slug };
}
async function edition(id: string, organizer: M, live: boolean) {
  const day = 86_400_000;
  const startsAt = new Date(Date.now() + (live ? -day : 30 * day)).toISOString();
  const endsAt = new Date(Date.now() + (live ? day : 31 * day)).toISOString();
  await db
    .prepare(
      `INSERT INTO hackathons (id, name, organizer, startsAt, endsAt, format, registrationUrl, tags, active, source)
       VALUES (?, ?, 'Org', ?, ?, 'presencial', '', '[]', 1, 'painel')`,
    )
    .run(id, `Edição ${id}`, startsAt, endsAt);
  await db.prepare("INSERT INTO edition_roles (hackathonId, memberId, role) VALUES (?, ?, 'organizador')").run(id, organizer.id);
}
async function post(by: M, body: string, scope: { communityId?: number; hackathonId?: string } = {}) {
  const r = await db
    .prepare("INSERT INTO posts (memberId, body, communityId, hackathonId) VALUES (?, ?, ?, ?) RETURNING id")
    .get<{ id: number }>(by.id, body, scope.communityId ?? null, scope.hackathonId ?? null);
  return r!.id;
}
async function comment(by: M, postId: number, body: string) {
  const r = await db
    .prepare("INSERT INTO post_comments (postId, memberId, body) VALUES (?, ?, ?) RETURNING id")
    .get<{ id: number }>(postId, by.id, body);
  return r!.id;
}
const as = (m: { clerkId: string } | null) => {
  clerk.uid = m?.clerkId ?? null;
};
const json = (method: string, body?: unknown, url = "http://t/api/reports") =>
  new Request(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const reportsRoute = () => import("@/app/api/reports/route");
const reportRoute = () => import("@/app/api/reports/[id]/route");
const idCtx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });
const notif = (memberId: number, href: string) =>
  db.prepare("SELECT text FROM notifications WHERE memberId = ? AND type = 'report' AND href = ?").all<{ text: string }>(memberId, href);

beforeEach(() => {
  resetRateLimits();
  as(null);
});

describe("POST /api/reports", () => {
  it("401 deslogado; 400 tipo, alvo ou motivo inválidos; 404 alvo que não existe ou tipo ainda sem página", async () => {
    const { POST } = await reportsRoute();
    expect((await POST(json("POST", { targetType: "post", targetId: "1", reason: "spam total" }))).status).toBe(401);
    const a = await member();
    const autor = await member();
    const p = await post(autor, "compre já");
    as(a);
    expect((await POST(json("POST", { targetType: "foto", targetId: String(p), reason: "spam total" }))).status).toBe(400);
    expect((await POST(json("POST", { targetType: "post", targetId: "", reason: "spam total" }))).status).toBe(400);
    const short = await POST(json("POST", { targetType: "post", targetId: String(p), reason: "x" }));
    expect(short.status).toBe(400);
    expect((await short.json()).error).toMatch(/poucas palavras/);
    resetRateLimits();
    expect((await POST(json("POST", { targetType: "post", targetId: String(p), reason: "y".repeat(501) }))).status).toBe(400);
    expect((await POST(json("POST", { targetType: "post", targetId: "999999", reason: "spam total" }))).status).toBe(404);
    expect((await POST(json("POST", { targetType: "comment", targetId: "abc", reason: "spam total" }))).status).toBe(404);
    resetRateLimits();
    // depoimento, dm e encontro chegam nas próximas ondas: por enquanto o alvo não existe
    expect((await POST(json("POST", { targetType: "depoimento", targetId: "1", reason: "spam total" }))).status).toBe(404);
    expect((await POST(json("POST", { targetType: "member", targetId: "999999", reason: "perfil falso" }))).status).toBe(404);
  });

  it("201, bloqueia o autor pra quem denunciou, 409 repetida em aberto; o próprio conteúdo é 400", async () => {
    const { POST } = await reportsRoute();
    const a = await member();
    const autor = await member();
    const p = await post(autor, "compre já meu curso");
    as(autor);
    const own = await POST(json("POST", { targetType: "post", targetId: p, reason: "teste próprio" }));
    expect(own.status).toBe(400);
    as(a);
    const r = await POST(json("POST", { targetType: "post", targetId: p, reason: "spam ou propaganda" }));
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body).toMatchObject({ ok: true, blocked: autor.username });
    expect(await isBlockedEither(a.id, autor.id)).toBe(true);
    const dup = await POST(json("POST", { targetType: "post", targetId: String(p), reason: "de novo" }));
    expect(dup.status).toBe(409);
    expect((await dup.json()).error).toMatch(/já denunciou/);
    const row = await getReport(body.id);
    expect(row).toMatchObject({ targetType: "post", snapshot: `@${autor.username}: compre já meu curso`, routedTo: "admin", href: "/feed" });
  });

  it("5 por hora por membro, depois 429 com Retry-After", async () => {
    const { POST } = await reportsRoute();
    const a = await member();
    const autor = await member();
    as(a);
    for (let i = 0; i < 5; i++) {
      const p = await post(autor, `post ${i}`);
      expect((await POST(json("POST", { targetType: "post", targetId: p, reason: "spam ou propaganda" }))).status).toBe(201);
    }
    const p = await post(autor, "mais um");
    const r = await POST(json("POST", { targetType: "post", targetId: p, reason: "spam ou propaganda" }));
    expect(r.status).toBe(429);
    expect(r.headers.get("Retry-After")).toBeTruthy();
  });
});

describe("roteamento e quem lê", () => {
  it("post de comunidade vai pro dono dela e pro admin, não pro dono de outra", async () => {
    const dono = await member();
    const outroDono = await member();
    const admin = await member("admin");
    const autor = await member();
    const quem = await member();
    const c = await community("dn-rota", dono);
    await community("dn-outra", outroDono);
    const p = await post(autor, "ofensa no mural", { communityId: c.id });
    const { id } = await createReport({ targetType: "post", targetId: String(p), reporterId: quem.id, reason: "ofensa ou assédio" });
    const rep = (await getReport(id))!;
    expect(rep).toMatchObject({ communityId: c.id, hackathonId: null, routedTo: "comunidade Comunidade dn-rota", href: "/comunidade/dn-rota" });
    expect(await canHandleReport(dono, rep)).toBe(true);
    expect(await canHandleReport(admin, rep)).toBe(true);
    expect(await canHandleReport(outroDono, rep)).toBe(false);
    expect(await canHandleReport(quem, rep)).toBe(false);
    // dono recebe aviso que leva pra fila; quem denunciou não aparece no texto
    const n = await notif(dono.id, "/comunidade/dn-rota/denuncias");
    expect(n).toHaveLength(1);
    expect(n[0].text).not.toContain(quem.username);

    const { GET } = await reportsRoute();
    as(dono);
    const mine = await GET(json("GET", undefined, "http://t/api/reports?comunidade=dn-rota"));
    expect(mine.status).toBe(200);
    expect((await mine.json()).reports.map((r: { id: number }) => r.id)).toEqual([id]);
    expect((await GET(json("GET", undefined, "http://t/api/reports"))).status).toBe(403);
    as(outroDono);
    expect((await GET(json("GET", undefined, "http://t/api/reports?comunidade=dn-rota"))).status).toBe(403);
    expect((await (await GET(json("GET", undefined, "http://t/api/reports?comunidade=dn-outra"))).json()).reports).toEqual([]);
    expect((await GET(json("GET", undefined, "http://t/api/reports?comunidade=nao-existe"))).status).toBe(404);
    as(admin);
    const all = await (await GET(json("GET", undefined, "http://t/api/reports?tipo=post"))).json();
    expect(all.reports.some((r: { id: number }) => r.id === id)).toBe(true);
    expect((await (await GET(json("GET", undefined, "http://t/api/reports?tipo=member"))).json()).reports).toEqual([]);
    as(null);
    expect((await GET(json("GET"))).status).toBe(401);
  });

  it("comentário segue o espaço do post; perfil e comunidade inteira vão pro admin", async () => {
    const dono = await member();
    const autor = await member();
    const quem = await member();
    const c = await community("dn-coment", dono);
    const p = await post(dono, "post do dono", { communityId: c.id });
    const cm = await comment(autor, p, "comentário ruim");
    const r1 = await createReport({ targetType: "comment", targetId: String(cm), reporterId: quem.id, reason: "conteúdo impróprio" });
    expect(await getReport(r1.id)).toMatchObject({ communityId: c.id, snapshot: `@${autor.username}: comentário ruim` });
    expect(r1.blocked).toBe(autor.username);

    const alvo = await member();
    const r2 = await createReport({ targetType: "member", targetId: String(alvo.id), reporterId: quem.id, reason: "perfil falso" });
    expect(await getReport(r2.id)).toMatchObject({ communityId: null, hackathonId: null, routedTo: "admin", href: `/u/${alvo.username}` });
    expect(await isBlockedEither(quem.id, alvo.id)).toBe(true);
    // comunidade inteira: admin, sem bloquear ninguém e sem cair na fila do próprio dono
    const r3 = await createReport({ targetType: "community", targetId: String(c.id), reporterId: quem.id, reason: "comunidade de golpe" });
    expect(r3.blocked).toBeNull();
    const rep3 = (await getReport(r3.id))!;
    expect(rep3).toMatchObject({ communityId: null, routedTo: "admin", href: "/comunidade/dn-coment" });
    expect(await canHandleReport(dono, rep3)).toBe(false);
    expect(await isBlockedEither(quem.id, dono.id)).toBe(false);
    expect(await countOpenByType({ global: true })).toMatchObject({ comment: 1, member: 1, community: 1 });
    expect(await countOpenByType({ communityId: c.id })).toEqual({ comment: 1 });
  });

  it("edição: fora do evento avisa a organização; com a edição rolando também abre incidente anônimo", async () => {
    const org = await member();
    const conduta = await member();
    const outroOrg = await member();
    const autor = await member();
    const quem = await member();
    await edition("dn-futura", org, false);
    await edition("dn-aovivo", org, true);
    await edition("dn-outra", outroOrg, true);
    await db.prepare("INSERT INTO edition_conduct_handlers (hackathonId, memberId) VALUES ('dn-aovivo', ?)").run(conduta.id);
    const incidents = async (h: string) =>
      db.prepare("SELECT kind, reporterId, description FROM incidents WHERE hackathonId = ?").all<{ kind: string; reporterId: number | null; description: string }>(h);

    const p1 = await post(autor, "post antes do evento", { hackathonId: "dn-futura" });
    const r1 = await createReport({ targetType: "post", targetId: String(p1), reporterId: quem.id, reason: "spam ou propaganda" });
    expect(r1.incidentId).toBeNull();
    expect(await incidents("dn-futura")).toEqual([]);
    expect(await notif(org.id, "/admin/h/dn-futura/denuncias")).toHaveLength(1);

    const p2 = await post(autor, "post no meio do evento", { hackathonId: "dn-aovivo" });
    const quem2 = await member();
    const r2 = await createReport({ targetType: "post", targetId: String(p2), reporterId: quem2.id, reason: "ofensa ou assédio" });
    expect(r2.incidentId).not.toBeNull();
    const inc = await incidents("dn-aovivo");
    expect(inc).toHaveLength(1);
    expect(inc[0]).toMatchObject({ kind: "outro", reporterId: null });
    expect(inc[0].description).toContain("post no meio do evento");
    expect(inc[0].description).toContain("/admin/h/dn-aovivo/denuncias");

    const rep2 = (await getReport(r2.id))!;
    expect(rep2).toMatchObject({ hackathonId: "dn-aovivo", routedTo: "edição Edição dn-aovivo", href: "/h/dn-aovivo" });
    expect(await canHandleReport(org, rep2)).toBe(true);
    expect(await canHandleReport(conduta, rep2)).toBe(true);
    expect(await canHandleReport(outroOrg, rep2)).toBe(false);
    expect((await listReports({ hackathonId: "dn-aovivo" })).map((r) => r.id)).toEqual([r2.id]);

    const { GET } = await reportsRoute();
    as(conduta);
    expect((await GET(json("GET", undefined, "http://t/api/reports?edicao=dn-aovivo"))).status).toBe(200);
    expect((await GET(json("GET", undefined, "http://t/api/reports?edicao=dn-futura"))).status).toBe(403);
    expect((await GET(json("GET", undefined, "http://t/api/reports?edicao=nao-existe"))).status).toBe(404);
  });
});

describe("ninguém modera denúncia contra si", () => {
  it("post do dono no mural da própria comunidade vai pro admin; o dono não é avisado, não vê e leva 403", async () => {
    const dono = await member();
    const org = await member();
    const admin = await member("admin");
    const quem = await member();
    const c = await community("dn-dono-autor", dono);
    await db.prepare("INSERT INTO community_members (communityId, memberId, role) VALUES (?, ?, 'organizador')").run(c.id, org.id);
    const p = await post(dono, "ofensa do dono", { communityId: c.id });
    const { POST, GET } = await reportsRoute();
    as(quem);
    const r = await POST(json("POST", { targetType: "post", targetId: String(p), reason: "ofensa ou assédio" }));
    expect(r.status).toBe(201);
    const { id } = await r.json();
    const rep = (await getReport(id))!;
    expect(rep).toMatchObject({ communityId: null, hackathonId: null, routedTo: "admin", targetMemberId: dono.id });
    expect(await canHandleReport(dono, rep)).toBe(false);
    expect(await canHandleReport(org, rep)).toBe(false);
    expect(await canHandleReport(admin, rep)).toBe(true);
    expect(await notif(dono.id, "/comunidade/dn-dono-autor/denuncias")).toEqual([]);
    expect(await notif(dono.id, "/admin#denuncias")).toEqual([]);
    expect(await notif(admin.id, "/admin#denuncias")).toHaveLength(1);
    as(dono);
    expect((await (await GET(json("GET", undefined, "http://t/api/reports?comunidade=dn-dono-autor"))).json()).reports).toEqual([]);
    const { PATCH } = await reportRoute();
    expect((await PATCH(json("PATCH", { resolution: "não vi problema" }), idCtx(id))).status).toBe(403);
    expect(await countOpenByType({ communityId: c.id, viewerId: dono.id })).toEqual({});
    as(admin);
    expect((await (await GET(json("GET", undefined, "http://t/api/reports?tipo=post"))).json()).reports.some((x: { id: number }) => x.id === id)).toBe(true);
  });

  it("comentário de organizador da comunidade também vai pro admin", async () => {
    const dono = await member();
    const org = await member();
    const autor = await member();
    const quem = await member();
    const c = await community("dn-org-autor", dono);
    await db.prepare("INSERT INTO community_members (communityId, memberId, role) VALUES (?, ?, 'organizador')").run(c.id, org.id);
    const p = await post(autor, "post comum", { communityId: c.id });
    const cm = await comment(org, p, "comentário do organizador");
    const { id } = await createReport({ targetType: "comment", targetId: String(cm), reporterId: quem.id, reason: "ofensa ou assédio" });
    expect(await getReport(id)).toMatchObject({ communityId: null, routedTo: "admin" });
    expect(await notif(dono.id, "/comunidade/dn-org-autor/denuncias")).toEqual([]);
  });

  it("organizador ou responsável de conduta denunciado no mural da edição rolando: vai pro admin, sem incidente", async () => {
    const org = await member();
    const conduta = await member();
    const quem = await member();
    const admin = await member("admin");
    await edition("dn-org-ao-vivo", org, true);
    await db.prepare("INSERT INTO edition_conduct_handlers (hackathonId, memberId) VALUES ('dn-org-ao-vivo', ?)").run(conduta.id);
    const p1 = await post(org, "post do organizador", { hackathonId: "dn-org-ao-vivo" });
    const r1 = await createReport({ targetType: "post", targetId: String(p1), reporterId: quem.id, reason: "ofensa ou assédio" });
    expect(r1.incidentId).toBeNull();
    const rep1 = (await getReport(r1.id))!;
    expect(rep1).toMatchObject({ hackathonId: null, routedTo: "admin" });
    expect(await canHandleReport(org, rep1)).toBe(false);
    expect(await canHandleReport(conduta, rep1)).toBe(false);
    expect(await canHandleReport(admin, rep1)).toBe(true);
    const p2 = await post(conduta, "post de quem trata conduta", { hackathonId: "dn-org-ao-vivo" });
    const quem2 = await member();
    const r2 = await createReport({ targetType: "post", targetId: String(p2), reporterId: quem2.id, reason: "ofensa ou assédio" });
    expect(r2.incidentId).toBeNull();
    expect(await getReport(r2.id)).toMatchObject({ hackathonId: null });
    const n = await db.prepare("SELECT COUNT(*) n FROM incidents WHERE hackathonId = 'dn-org-ao-vivo'").get<{ n: number }>();
    expect(Number(n?.n)).toBe(0);
  });

  it("quem virou moderador depois da denúncia não vê nem resolve a que é contra si", async () => {
    const dono = await member();
    const autor = await member();
    const quem = await member();
    const c = await community("dn-promovido", dono);
    const p = await post(autor, "post antes de virar organizador", { communityId: c.id });
    const { id } = await createReport({ targetType: "post", targetId: String(p), reporterId: quem.id, reason: "spam ou propaganda" });
    expect(await getReport(id)).toMatchObject({ communityId: c.id, targetMemberId: autor.id });
    await db.prepare("INSERT INTO community_members (communityId, memberId, role) VALUES (?, ?, 'organizador')").run(c.id, autor.id);
    expect(await canHandleReport(autor, (await getReport(id))!)).toBe(false);
    expect(await listReports({ communityId: c.id, viewerId: autor.id })).toEqual([]);
    expect(await countOpenByType({ communityId: c.id, viewerId: autor.id })).toEqual({});
    // o dono continua vendo
    expect((await listReports({ communityId: c.id, viewerId: dono.id })).map((r) => r.id)).toEqual([id]);
    expect(await countOpenByType({ communityId: c.id, viewerId: dono.id })).toEqual({ post: 1 });
    const { PATCH } = await reportRoute();
    as(autor);
    expect((await PATCH(json("PATCH", { resolution: "não vi problema" }), idCtx(id))).status).toBe(403);
  });
});

describe("comunidade escondida", () => {
  it("post e comentário de comunidade escondida dão 404 pra quem não é admin, sem bloquear nem avisar", async () => {
    const dono = await member();
    const autor = await member();
    const quem = await member();
    const admin = await member("admin");
    const c = await community("dn-escondida", dono);
    const p = await post(autor, "post escondido", { communityId: c.id });
    const cm = await comment(autor, p, "comentário escondido");
    await setModeration(c.id, { hidden: true });
    const { POST } = await reportsRoute();
    as(quem);
    const r = await POST(json("POST", { targetType: "post", targetId: String(p), reason: "spam total" }));
    expect(r.status).toBe(404);
    expect(await r.json()).not.toHaveProperty("blocked");
    expect((await POST(json("POST", { targetType: "comment", targetId: String(cm), reason: "spam total" }))).status).toBe(404);
    expect(await isBlockedEither(quem.id, autor.id)).toBe(false);
    expect(await notif(dono.id, "/comunidade/dn-escondida/denuncias")).toEqual([]);
    as(admin);
    expect((await POST(json("POST", { targetType: "post", targetId: String(p), reason: "spam total" }))).status).toBe(201);
  });
});

describe("PATCH /api/reports/[id]", () => {
  it("401, 404, 403 pra quem não modera, 400 sem dizer o que foi feito, 200 e 409 na segunda vez", async () => {
    const { PATCH } = await reportRoute();
    const dono = await member();
    const outroDono = await member();
    const autor = await member();
    const quem = await member();
    const c = await community("dn-resolve", dono);
    await community("dn-resolve-outra", outroDono);
    const p = await post(autor, "spam", { communityId: c.id });
    const { id } = await createReport({ targetType: "post", targetId: String(p), reporterId: quem.id, reason: "spam ou propaganda" });
    expect((await PATCH(json("PATCH", { resolution: "tirei do ar" }), idCtx(id))).status).toBe(401);
    as(dono);
    expect((await PATCH(json("PATCH", { resolution: "tirei do ar" }), idCtx(999999))).status).toBe(404);
    expect((await PATCH(json("PATCH", { resolution: "tirei do ar" }), idCtx("abc"))).status).toBe(404);
    as(outroDono);
    expect((await PATCH(json("PATCH", { resolution: "tirei do ar" }), idCtx(id))).status).toBe(403);
    as(quem);
    expect((await PATCH(json("PATCH", { resolution: "tirei do ar" }), idCtx(id))).status).toBe(403);
    as(dono);
    expect((await PATCH(json("PATCH", { resolution: "" }), idCtx(id))).status).toBe(400);
    const ok = await PATCH(json("PATCH", { resolution: "tirei o conteúdo do ar" }), idCtx(id));
    expect(ok.status).toBe(200);
    expect((await ok.json()).report).toMatchObject({ resolution: "tirei o conteúdo do ar", resolvedByUsername: dono.username });
    expect((await PATCH(json("PATCH", { resolution: "de novo" }), idCtx(id))).status).toBe(409);
    expect(await listReports({ communityId: c.id })).toEqual([]);
    expect((await listReports({ communityId: c.id }, { status: "resolved" })).map((r) => r.id)).toEqual([id]);
    // resolvida, a mesma pessoa pode denunciar de novo
    await expect(
      createReport({ targetType: "post", targetId: String(p), reporterId: quem.id, reason: "voltou a postar" }),
    ).resolves.toMatchObject({ blocked: autor.username });
  });
});

describe("denúncia de comunidade (027) na fila nova", () => {
  it("a rota antiga grava em reports, a repetida não abre outra e esconder resolve", async () => {
    const dono = await member();
    const quem = await member();
    const c = await community("dn-antiga", dono);
    await reportCommunity(c.id, quem.id, "comunidade de golpe");
    await reportCommunity(c.id, quem.id, "de novo");
    const open = await listReports({ global: true }, { type: "community" });
    expect(open.filter((r) => r.targetId === String(c.id))).toHaveLength(1);
    expect((await listCommunities({ includeHidden: true })).find((x) => x.slug === "dn-antiga")?.reports).toBe(1);
    const legacy = await db.prepare("SELECT COUNT(*) n FROM community_reports WHERE communityId = ?").get<{ n: number }>(c.id);
    expect(Number(legacy?.n)).toBe(0);
    await setModeration(c.id, { hidden: true });
    expect((await listReports({ global: true }, { type: "community" })).filter((r) => r.targetId === String(c.id))).toEqual([]);
    expect((await listCommunities({ includeHidden: true })).find((x) => x.slug === "dn-antiga")?.reports).toBe(0);
  });

  it("migração: as denúncias antigas aparecem na fila nova, duplicata aberta vira uma e a resolvida fica resolvida", async () => {
    const dono = await member();
    const a = await member();
    const b = await member();
    const c = await community("dn-migra", dono);
    await db
      .prepare(
        `INSERT INTO community_reports (communityId, memberId, reason, createdAt, resolvedAt) VALUES
         (?, ?, 'spam antigo', '2026-09-01 10:00:00', NULL),
         (?, ?, 'spam antigo repetido', '2026-09-02 10:00:00', NULL),
         (?, ?, 'outra pessoa', '2026-09-03 10:00:00', NULL),
         (?, ?, 'resolvida', '2026-09-04 10:00:00', '2026-09-05 10:00:00')`,
      )
      .run(c.id, a.id, c.id, a.id, c.id, b.id, c.id, b.id);
    const sql = readFileSync(join(process.cwd(), "migrations", "032_bloqueio_denuncia.sql"), "utf8");
    const insert = sql.slice(sql.indexOf("INSERT INTO reports"));
    await db.prepare(insert.replace(/;\s*$/, "")).run();
    const rows = await db
      .prepare("SELECT reporterId, reason, snapshot, createdAt, resolvedAt, resolution, communityId FROM reports WHERE targetType = 'community' AND targetId = ? ORDER BY id")
      .all<{ reporterId: number; reason: string; snapshot: string; createdAt: string; resolvedAt: string | null; resolution: string | null; communityId: number | null }>(String(c.id));
    expect(rows.map((r) => r.reason)).toEqual(["spam antigo", "outra pessoa", "resolvida"]);
    expect(rows[0]).toMatchObject({ reporterId: a.id, snapshot: "Comunidade dn-migra", createdAt: "2026-09-01 10:00:00", communityId: null });
    expect(rows[2]).toMatchObject({ resolvedAt: "2026-09-05 10:00:00", resolution: "comunidade escondida" });
    const open = await listReports({ global: true }, { type: "community" });
    expect(open.filter((r) => r.targetId === String(c.id)).map((r) => r.reason)).toEqual(["spam antigo", "outra pessoa"]);
  });
});

describe("LGPD", () => {
  it("excluir a conta de quem denunciou mantém a denúncia sem autor; o export não traz o texto denunciado", async () => {
    const autor = await member();
    const quem = await member();
    const p = await post(autor, "texto de outra pessoa");
    const { id } = await createReport({ targetType: "post", targetId: String(p), reporterId: quem.id, reason: "spam ou propaganda" });
    const exp = await exportMemberData(quem.id);
    const mine = exp!.data["reports.reporterId"] as Record<string, unknown>[];
    expect(mine).toHaveLength(1);
    expect(mine[0].reason).toBe("spam ou propaganda");
    expect(mine[0]).not.toHaveProperty("snapshot");
    // quem foi denunciado não fica sabendo pelo export
    expect(Object.keys((await exportMemberData(autor.id))!.data).some((k) => k.startsWith("reports.") || k.startsWith("member_blocks."))).toBe(false);

    await deleteMemberData(quem.id);
    const row = await db.prepare("SELECT reporterId, reason, snapshot FROM reports WHERE id = ?").get<{ reporterId: number | null; reason: string; snapshot: string }>(id);
    expect(row).toEqual({ reporterId: null, reason: "spam ou propaganda", snapshot: `@${autor.username}: texto de outra pessoa` });
    expect((await listReports({ global: true })).some((r) => r.id === id)).toBe(true);
  });

  it("erro de domínio sai como ReportError com status", async () => {
    const quem = await member();
    await expect(createReport({ targetType: "post", targetId: "1", reporterId: quem.id, reason: "x" })).rejects.toBeInstanceOf(ReportError);
  });
});
