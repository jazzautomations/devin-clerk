import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { getCommunityBySlug, listCommunities, listMyCommunities } from "@/lib/communities";
import { listCommunityBans, listCommunityLog, isBannedFromCommunity } from "@/lib/communityModeration";
import { followCommunity } from "@/lib/follows";
import { resolveReport, createReport } from "@/lib/reports";
import { resetRateLimits } from "@/lib/ratelimit";

// Comunidade dona do próprio espaço (migration 046): fila de denúncia roteada
// pra comunidade, aviso editado e apagado, membro removido e banido, exclusão
// e transferência de posse. Cada poder e cada 403, e o log de tudo.

const clerk = vi.hoisted(() => ({ uid: null as string | null }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: clerk.uid })),
  currentUser: vi.fn(async () => null),
}));

let seq = 0;
type M = { id: number; clerkId: string; username: string; role: string };
async function member(role = "member"): Promise<M> {
  const tag = `cd${seq++}`;
  const row = await db
    .prepare("INSERT INTO members (clerkId, username, email, name, role) VALUES (?, ?, ?, ?, ?) RETURNING id")
    .get<{ id: number }>(`clerk_${tag}`, `u_${tag}`, `${tag}@t.dev`, `Pessoa ${tag}`, role);
  return { id: row!.id, clerkId: `clerk_${tag}`, username: `u_${tag}`, role };
}
async function community(slug: string, dono: M) {
  const c = await db
    .prepare("INSERT INTO communities (slug, name, description, city) VALUES (?, ?, 'sobre', 'Recife, PE') RETURNING id")
    .get<{ id: number }>(slug, `Comunidade ${slug}`);
  await db.prepare("INSERT INTO community_members (communityId, memberId, role) VALUES (?, ?, 'dono')").run(c!.id, dono.id);
  return { id: c!.id, slug, name: `Comunidade ${slug}` };
}
async function join(communityId: number, m: M, role = "membro") {
  await db
    .prepare(
      `INSERT INTO community_members (communityId, memberId, role) VALUES (?, ?, ?)
       ON CONFLICT (communityId, memberId) DO UPDATE SET role = EXCLUDED.role`,
    )
    .run(communityId, m.id, role);
}
async function notice(communityId: number, by: M, title = "Aviso de teste") {
  const r = await db
    .prepare("INSERT INTO community_notices (communityId, title, body, createdBy) VALUES (?, ?, 'texto do aviso', ?) RETURNING id")
    .get<{ id: number }>(communityId, title, by.id);
  return r!.id;
}
async function post(by: M, communityId: number, body = "post do mural") {
  const r = await db
    .prepare("INSERT INTO posts (memberId, body, communityId) VALUES (?, ?, ?) RETURNING id")
    .get<{ id: number }>(by.id, body, communityId);
  return r!.id;
}
const as = (m: { clerkId: string } | null) => {
  clerk.uid = m?.clerkId ?? null;
};
const req = (method: string, body?: unknown) =>
  new Request("http://t/api/communities/x", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const ctx = <T extends Record<string, string>>(params: T) => ({ params: Promise.resolve(params) });

const removeRoute = () => import("@/app/api/communities/[slug]/members/[username]/route");
const bansRoute = () => import("@/app/api/communities/[slug]/bans/[username]/route");
const noticesRoute = () => import("@/app/api/communities/[slug]/notices/[noticeId]/route");
const transferRoute = () => import("@/app/api/communities/[slug]/transfer/route");
const communityRoute = () => import("@/app/api/communities/[slug]/route");
const joinRoute = () => import("@/app/api/communities/[slug]/members/route");
const followRoute = () => import("@/app/api/communities/[slug]/follow/route");

beforeEach(() => {
  resetRateLimits();
  as(null);
});

describe("rotas de moderação da comunidade", () => {
  it("401 deslogado em todas", async () => {
    const { DELETE: remove } = await removeRoute();
    const { DELETE: unban } = await bansRoute();
    const { PATCH: edit, DELETE: del } = await noticesRoute();
    const { POST: transfer } = await transferRoute();
    const { DELETE: drop } = await communityRoute();
    expect((await remove(req("DELETE", {}), ctx({ slug: "x", username: "y" }))).status).toBe(401);
    expect((await unban(req("DELETE"), ctx({ slug: "x", username: "y" }))).status).toBe(401);
    expect((await edit(req("PATCH", { title: "a" }), ctx({ slug: "x", noticeId: "1" }))).status).toBe(401);
    expect((await del(req("DELETE"), ctx({ slug: "x", noticeId: "1" }))).status).toBe(401);
    expect((await transfer(req("POST", { username: "y" }), ctx({ slug: "x" }))).status).toBe(401);
    expect((await drop(req("DELETE", { confirm: "x" }), ctx({ slug: "x" }))).status).toBe(401);
  });

  it("organizador de outra comunidade leva 403 em tudo", async () => {
    const donoA = await member();
    const donoB = await member();
    const orgB = await member();
    const a = await community("cd-outra-a", donoA);
    const b = await community("cd-outra-b", donoB);
    await join(b.id, orgB, "organizador");
    const n = await notice(a.id, donoA);
    as(orgB);
    const { DELETE: remove } = await removeRoute();
    const { PATCH: edit } = await noticesRoute();
    const { POST: transfer } = await transferRoute();
    const { DELETE: drop } = await communityRoute();
    const alvo = await member();
    await join(a.id, alvo);
    expect((await remove(req("DELETE", { ban: true }), ctx({ slug: a.slug, username: alvo.username }))).status).toBe(403);
    expect((await edit(req("PATCH", { title: "outro" }), ctx({ slug: a.slug, noticeId: String(n) }))).status).toBe(403);
    expect((await transfer(req("POST", { username: alvo.username }), ctx({ slug: a.slug }))).status).toBe(403);
    expect((await drop(req("DELETE", { confirm: a.slug }), ctx({ slug: a.slug }))).status).toBe(403);
    // e o aviso continua como estava
    expect(await db.prepare("SELECT title FROM community_notices WHERE id = ?").get(n)).toEqual({ title: "Aviso de teste" });
  });
});

describe("remover membro", () => {
  it("organizador remove membro, não remove organizador nem o dono, e o removido é avisado", async () => {
    const dono = await member();
    const org = await member();
    const membro = await member();
    const outroOrg = await member();
    const c = await community("cd-remover", dono);
    await join(c.id, org, "organizador");
    await join(c.id, membro);
    await join(c.id, outroOrg, "organizador");
    const { DELETE: remove } = await removeRoute();

    as(org);
    const dono403 = await remove(req("DELETE", {}), ctx({ slug: c.slug, username: dono.username }));
    expect(dono403.status).toBe(403);
    expect((await dono403.json()).error).toMatch(/O dono não sai por aqui/);

    const org403 = await remove(req("DELETE", {}), ctx({ slug: c.slug, username: outroOrg.username }));
    expect(org403.status).toBe(403);
    expect((await org403.json()).error).toMatch(/Só o dono/);

    const ok = await remove(req("DELETE", {}), ctx({ slug: c.slug, username: membro.username }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, banned: false });
    expect(await db.prepare("SELECT 1 FROM community_members WHERE communityId = ? AND memberId = ?").get(c.id, membro.id)).toBeUndefined();
    const note = await db
      .prepare("SELECT text, href FROM notifications WHERE memberId = ? AND type = 'community_remove'")
      .get<{ text: string; href: string }>(membro.id);
    expect(note).toEqual({ text: "Você não faz mais parte da Comunidade cd-remover.", href: "/comunidades" });

    // o dono remove organizador (e continua sem poder se remover)
    as(dono);
    expect((await remove(req("DELETE", {}), ctx({ slug: c.slug, username: outroOrg.username }))).status).toBe(200);
    // quem não está na comunidade é 404
    const fora = await member();
    expect((await remove(req("DELETE", {}), ctx({ slug: c.slug, username: fora.username }))).status).toBe(404);
    // pessoa que não existe é 404
    expect((await remove(req("DELETE", {}), ctx({ slug: c.slug, username: "ninguem-aqui" }))).status).toBe(404);

    const log = await listCommunityLog(c.id);
    expect(log.map((l) => l.action)).toEqual(["member.remove", "member.remove"]);
    expect(log[0].target).toBe(`@${outroOrg.username}`);
    expect(log[0].username).toBe(dono.username);
  });

  it("admin global modera como dono, mesmo tendo entrado como membro comum", async () => {
    const dono = await member();
    const org = await member();
    const admin = await member("admin");
    const c = await community("cd-admin", dono);
    await join(c.id, org, "organizador");
    await join(c.id, admin);
    as(admin);
    const { DELETE: remove } = await removeRoute();
    expect((await remove(req("DELETE", {}), ctx({ slug: c.slug, username: org.username }))).status).toBe(200);
    // ninguém remove o dono, nem o admin
    expect((await remove(req("DELETE", {}), ctx({ slug: c.slug, username: dono.username }))).status).toBe(403);
  });

  it("ban: sai de membros e de seguir, não entra nem segue de novo, e liberar devolve a entrada", async () => {
    const dono = await member();
    const alvo = await member();
    const c = await community("cd-ban", dono);
    await join(c.id, alvo);
    await db.prepare("INSERT INTO community_follows (communityId, memberId) VALUES (?, ?)").run(c.id, alvo.id);

    as(dono);
    const { DELETE: remove } = await removeRoute();
    const r = await remove(req("DELETE", { ban: true, reason: "ofensa no mural" }), ctx({ slug: c.slug, username: alvo.username }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, banned: true });
    expect(await isBannedFromCommunity(c.id, alvo.id)).toBe(true);
    expect(await db.prepare("SELECT 1 FROM community_follows WHERE communityId = ? AND memberId = ?").get(c.id, alvo.id)).toBeUndefined();
    expect(await listCommunityBans(c.id)).toMatchObject([
      { memberId: alvo.id, username: alvo.username, reason: "ofensa no mural", byUsername: dono.username },
    ]);

    // entrar e seguir com ban: 403 com a mesma frase
    as(alvo);
    const { POST: joinPost } = await joinRoute();
    const { POST: followPost } = await followRoute();
    const entrar = await joinPost(req("POST"), ctx({ slug: c.slug }));
    expect(entrar.status).toBe(403);
    expect((await entrar.json()).error).toBe("Você não pode entrar nesta comunidade.");
    const seguir = await followPost(req("POST"), ctx({ slug: c.slug }));
    expect(seguir.status).toBe(403);
    expect((await seguir.json()).error).toBe("Você não pode entrar nesta comunidade.");
    expect(await followCommunity(c.id, alvo.id)).toBe("banned");

    // liberar a volta
    as(dono);
    const { DELETE: unban } = await bansRoute();
    expect((await unban(req("DELETE"), ctx({ slug: c.slug, username: alvo.username }))).status).toBe(200);
    expect(await isBannedFromCommunity(c.id, alvo.id)).toBe(false);
    as(alvo);
    expect((await joinPost(req("POST"), ctx({ slug: c.slug }))).status).toBe(201);
    expect((await listCommunityLog(c.id)).map((l) => l.action)).toEqual(["member.unban", "member.ban"]);
    // liberar quem não está impedido é 404
    as(dono);
    expect((await unban(req("DELETE"), ctx({ slug: c.slug, username: alvo.username }))).status).toBe(404);
  });
});

describe("aviso: editar e apagar", () => {
  it("edita o que veio, apaga, grava no log e não deixa vazar pra outra comunidade", async () => {
    const dono = await member();
    const org = await member();
    const c = await community("cd-aviso", dono);
    const outra = await community("cd-aviso-outra", dono);
    await join(c.id, org, "organizador");
    const n = await notice(c.id, dono, "Encontro de sábado");
    const alheio = await notice(outra.id, dono, "Aviso da outra");
    const { PATCH: edit, DELETE: del } = await noticesRoute();

    as(org);
    const p = await edit(req("PATCH", { body: "mudou o horário pra 14h" }), ctx({ slug: c.slug, noticeId: String(n) }));
    expect(p.status).toBe(200);
    expect((await p.json()).notice).toMatchObject({ id: n, title: "Encontro de sábado", body: "mudou o horário pra 14h" });
    // título vazio e aviso grande demais: 400
    expect((await edit(req("PATCH", { title: "   " }), ctx({ slug: c.slug, noticeId: String(n) }))).status).toBe(400);
    expect((await edit(req("PATCH", { body: "x".repeat(1001) }), ctx({ slug: c.slug, noticeId: String(n) }))).status).toBe(400);
    expect((await edit(req("PATCH", {}), ctx({ slug: c.slug, noticeId: String(n) }))).status).toBe(400);
    // aviso de outra comunidade: 404 (não vaza)
    expect((await edit(req("PATCH", { title: "sequestrado" }), ctx({ slug: c.slug, noticeId: String(alheio) }))).status).toBe(404);
    expect((await del(req("DELETE"), ctx({ slug: c.slug, noticeId: String(alheio) }))).status).toBe(404);
    expect((await del(req("DELETE"), ctx({ slug: c.slug, noticeId: "999999" }))).status).toBe(404);

    const d = await del(req("DELETE"), ctx({ slug: c.slug, noticeId: String(n) }));
    expect(d.status).toBe(200);
    expect(await db.prepare("SELECT 1 FROM community_notices WHERE id = ?").get(n)).toBeUndefined();
    expect((await listCommunityLog(c.id)).map((l) => [l.action, l.target])).toEqual([
      ["notice.delete", 'aviso "Encontro de sábado"'],
      ["notice.edit", 'aviso "Encontro de sábado"'],
    ]);
  });
});

describe("excluir comunidade", () => {
  it("só o dono, só com o endereço digitado; some da lista, a página dá 404 e o hackathon fica", async () => {
    const dono = await member();
    const org = await member();
    const c = await community("cd-excluir", dono);
    await join(c.id, org, "organizador");
    await db
      .prepare(
        `INSERT INTO hackathons (id, name, organizer, startsAt, format, registrationUrl, tags, active, source, communityId)
         VALUES ('cd-excluir-hack', 'Edição da comunidade', 'Org', '2026-03-01 09:00:00', 'presencial', '', '[]', 1, 'painel', ?)`,
      )
      .run(c.id);
    const { DELETE: drop } = await communityRoute();

    as(org);
    expect((await drop(req("DELETE", { confirm: c.slug }), ctx({ slug: c.slug }))).status).toBe(403);
    as(dono);
    expect((await drop(req("DELETE", { confirm: "outro" }), ctx({ slug: c.slug }))).status).toBe(400);
    expect((await drop(req("DELETE", {}), ctx({ slug: c.slug }))).status).toBe(400);
    const ok = await drop(req("DELETE", { confirm: c.slug }), ctx({ slug: c.slug }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).ok).toBe(true);

    expect(await getCommunityBySlug(c.slug)).toBeNull();
    expect((await listCommunities({ q: "cd-excluir" })).some((x) => x.slug === c.slug)).toBe(false);
    expect((await listMyCommunities(dono.id)).some((x) => x.slug === c.slug)).toBe(false);
    const row = await db.prepare("SELECT hidden, deletedAt FROM communities WHERE id = ?").get<{ hidden: number; deletedAt: string | null }>(c.id);
    expect(row?.hidden).toBe(1);
    expect(row?.deletedAt).toBeTruthy();
    // o hackathon continua existindo, ainda apontando pra comunidade
    expect(await db.prepare("SELECT communityId FROM hackathons WHERE id = 'cd-excluir-hack'").get()).toEqual({ communityId: c.id });
    // de novo: a comunidade não existe mais (404 nas rotas)
    expect((await drop(req("DELETE", { confirm: c.slug }), ctx({ slug: c.slug }))).status).toBe(404);
    expect((await listCommunityLog(c.id)).map((l) => l.action)).toEqual(["community.delete"]);
  });
});

describe("transferir posse", () => {
  it("só o dono, só pra organizador; troca os papéis, avisa e registra", async () => {
    const dono = await member();
    const org = await member();
    const membro = await member();
    const c = await community("cd-transferir", dono);
    await join(c.id, org, "organizador");
    await join(c.id, membro);
    const { POST: transfer } = await transferRoute();

    as(org);
    expect((await transfer(req("POST", { username: dono.username }), ctx({ slug: c.slug }))).status).toBe(403);
    as(dono);
    expect((await transfer(req("POST", { username: membro.username }), ctx({ slug: c.slug }))).status).toBe(400);
    expect((await transfer(req("POST", { username: "ninguem-aqui" }), ctx({ slug: c.slug }))).status).toBe(404);
    expect((await transfer(req("POST", {}), ctx({ slug: c.slug }))).status).toBe(400);
    expect((await transfer(req("POST", { username: dono.username }), ctx({ slug: c.slug }))).status).toBe(400);

    const ok = await transfer(req("POST", { username: `@${org.username}` }), ctx({ slug: c.slug }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, owner: org.username });
    const roles = await db
      .prepare("SELECT memberId, role FROM community_members WHERE communityId = ? ORDER BY memberId")
      .all<{ memberId: number; role: string }>(c.id);
    expect(Object.fromEntries(roles.map((r) => [r.memberId, r.role]))).toEqual({
      [dono.id]: "organizador",
      [org.id]: "dono",
      [membro.id]: "membro",
    });
    expect(await db.prepare("SELECT text FROM notifications WHERE memberId = ? AND type = 'community_role'").get(org.id)).toEqual({
      text: "Você agora é dono da Comunidade cd-transferir no HackaHub.",
    });
    expect((await listCommunityLog(c.id)).map((l) => l.action)).toEqual(["community.transfer"]);
    // o antigo dono agora é organizador: pode moderar, mas não transfere mais
    as(dono);
    expect((await transfer(req("POST", { username: org.username }), ctx({ slug: c.slug }))).status).toBe(403);
  });
});

describe("fila de denúncia da comunidade", () => {
  it("a resolução entra no log da comunidade e o organizador resolve o que é daqui", async () => {
    const dono = await member();
    const org = await member();
    const autor = await member();
    const fiscal = await member();
    const outroOrg = await member();
    const c = await community("cd-fila", dono);
    const outra = await community("cd-fila-outra", dono);
    await join(c.id, org, "organizador");
    await join(c.id, autor);
    await join(outra.id, outroOrg, "organizador");
    const p = await post(autor, c.id, "compre seguidores no meu link");
    const r = await createReport({ targetType: "post", targetId: String(p), reporterId: fiscal.id, reason: "spam ou propaganda" });
    // organizador de outra comunidade não resolve a denúncia desta
    expect(await resolveReport(r.id, outroOrg, "não é daqui")).toEqual({ ok: false, status: 403, error: "Forbidden" });
    const res = await resolveReport(r.id, org, "post apagado");
    expect(res.ok).toBe(true);
    expect((await listCommunityLog(c.id)).map((l) => [l.action, l.target])).toEqual([["report.resolve", `#${r.id}`]]);
    expect((await listCommunityLog(c.id))[0].username).toBe(org.username);
  });
});
