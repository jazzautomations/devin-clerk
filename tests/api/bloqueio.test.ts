import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import {
  block,
  hiddenIdsFor,
  isBlockedBy,
  isBlockedEither,
  listMySafety,
  mute,
  relationTo,
  unblock,
  unmute,
} from "@/lib/blocks";
import { listCommunityUpdates } from "@/lib/follows";
import { changeUsername } from "@/lib/members";
import { listNotifications, notify, unreadCount } from "@/lib/notifications";
import { listPosts } from "@/lib/posts";
import { deleteMemberData, exportMemberData } from "@/lib/privacy";
import { resetRateLimits } from "@/lib/ratelimit";

// Bloquear e silenciar (migration 032): rota (401/404/400/429), os dois
// sentidos do bloqueio, silêncio só pra quem silenciou, ninguém avisado,
// feed e notificações filtrados, lista de /perfil/bloqueados e LGPD.

const clerk = vi.hoisted(() => ({ uid: null as string | null }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: clerk.uid })),
  currentUser: vi.fn(async () => null),
}));

let seq = 0;
type M = { id: number; clerkId: string; username: string };
async function member(): Promise<M> {
  const tag = `bq${seq++}`;
  const row = await db
    .prepare("INSERT INTO members (clerkId, username, email, name) VALUES (?, ?, ?, ?) RETURNING id")
    .get<{ id: number }>(`clerk_${tag}`, `u_${tag}`, `${tag}@t.dev`, `Pessoa ${tag}`);
  return { id: row!.id, clerkId: `clerk_${tag}`, username: `u_${tag}` };
}
async function post(by: number, body: string, communityId: number | null = null) {
  await db.prepare("INSERT INTO posts (memberId, body, communityId) VALUES (?, ?, ?)").run(by, body, communityId);
}
const as = (m: { clerkId: string } | null) => {
  clerk.uid = m?.clerkId ?? null;
};
const req = (method: string) => new Request("http://t", { method });
const ctx = (username: string) => ({ params: Promise.resolve({ username }) });
const blockRoute = () => import("@/app/api/members/[username]/block/route");
const muteRoute = () => import("@/app/api/members/[username]/mute/route");
const notificationsOf = async (id: number) =>
  Number((await db.prepare("SELECT COUNT(*) n FROM notifications WHERE memberId = ?").get<{ n: number }>(id))?.n);

beforeEach(() => {
  resetRateLimits();
  as(null);
});

describe("rotas /api/members/[username]/block e /mute", () => {
  it("401 deslogado, 404 quem não existe ou saiu, 400 a si mesmo", async () => {
    const { POST, DELETE } = await blockRoute();
    const mr = await muteRoute();
    const a = await member();
    const b = await member();
    expect((await POST(req("POST"), ctx(b.username))).status).toBe(401);
    expect((await DELETE(req("DELETE"), ctx(b.username))).status).toBe(401);
    expect((await mr.POST(req("POST"), ctx(b.username))).status).toBe(401);
    as(a);
    expect((await POST(req("POST"), ctx("nao_existe"))).status).toBe(404);
    expect((await mr.POST(req("POST"), ctx("nao_existe"))).status).toBe(404);
    const saiu = await member();
    await deleteMemberData(saiu.id);
    expect((await POST(req("POST"), ctx(`removido-${saiu.id}`))).status).toBe(404);
    const self = await POST(req("POST"), ctx(a.username));
    expect(self.status).toBe(400);
    expect((await self.json()).error).toMatch(/você mesmo/);
    expect((await mr.POST(req("POST"), ctx(a.username))).status).toBe(400);
  });

  it("bloqueia, repete sem erro, desbloqueia; silencia e desfaz; ninguém é avisado", async () => {
    const { POST, DELETE } = await blockRoute();
    const mr = await muteRoute();
    const a = await member();
    const b = await member();
    as(a);
    const r = await POST(req("POST"), ctx(b.username));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, blocked: true });
    expect((await POST(req("POST"), ctx(b.username))).status).toBe(200);
    expect(await relationTo(a.id, b.id)).toEqual({ blocked: true, muted: false });
    expect(await (await DELETE(req("DELETE"), ctx(b.username))).json()).toEqual({ ok: true, blocked: false });
    expect(await isBlockedEither(a.id, b.id)).toBe(false);

    expect(await (await mr.POST(req("POST"), ctx(b.username))).json()).toEqual({ ok: true, muted: true });
    expect(await relationTo(a.id, b.id)).toEqual({ blocked: false, muted: true });
    expect(await (await mr.DELETE(req("DELETE"), ctx(b.username))).json()).toEqual({ ok: true, muted: false });
    expect(await relationTo(a.id, b.id)).toEqual({ blocked: false, muted: false });
    expect(await notificationsOf(b.id)).toBe(0);
  });

  it("aceita @ com maiúscula no endereço", async () => {
    const { POST } = await blockRoute();
    const a = await member();
    const b = await member();
    as(a);
    expect((await POST(req("POST"), ctx(b.username.toUpperCase()))).status).toBe(200);
    expect(await isBlockedBy(b.id, a.id)).toBe(true);
  });

  it("bloquear e silenciar dividem 30 por hora; depois 429 com Retry-After", async () => {
    const { POST, DELETE } = await blockRoute();
    const mr = await muteRoute();
    const a = await member();
    const b = await member();
    as(a);
    for (let i = 0; i < 10; i++) {
      expect((await POST(req("POST"), ctx(b.username))).status).toBe(200);
      expect((await DELETE(req("DELETE"), ctx(b.username))).status).toBe(200);
      expect((await mr.POST(req("POST"), ctx(b.username))).status).toBe(200);
    }
    const r = await mr.DELETE(req("DELETE"), ctx(b.username));
    expect(r.status).toBe(429);
    expect(r.headers.get("Retry-After")).toBeTruthy();
  });
});

describe("lib/blocks", () => {
  it("bloqueio vale nos dois sentidos pra leitura; isBlockedBy só pro lado de quem bloqueou", async () => {
    const a = await member();
    const b = await member();
    const c = await member();
    expect(await block(a.id, b.id)).toBe(true);
    expect(await block(a.id, b.id)).toBe(false);
    expect(await isBlockedEither(a.id, b.id)).toBe(true);
    expect(await isBlockedEither(b.id, a.id)).toBe(true);
    expect(await isBlockedEither(a.id, c.id)).toBe(false);
    // B foi bloqueado por A: B não vê o /u de A; A ainda vê o de B (pra desfazer)
    expect(await isBlockedBy(b.id, a.id)).toBe(true);
    expect(await isBlockedBy(a.id, b.id)).toBe(false);
    await expect(block(a.id, a.id)).rejects.toThrow();
    expect(await unblock(a.id, b.id)).toBe(true);
    expect(await unblock(a.id, b.id)).toBe(false);
  });

  it("hiddenIdsFor: blocked junta os dois sentidos, muted é só de quem silenciou", async () => {
    const me = await member();
    const euBloqueei = await member();
    const meBloqueou = await member();
    const silenciei = await member();
    const meSilenciou = await member();
    await block(me.id, euBloqueei.id);
    await block(meBloqueou.id, me.id);
    await mute(me.id, silenciei.id);
    await mute(meSilenciou.id, me.id);
    const h = await hiddenIdsFor(me.id);
    expect(h.blocked.sort()).toEqual([euBloqueei.id, meBloqueou.id].sort());
    expect(h.muted).toEqual([silenciei.id]);
    // do lado de quem me silenciou, nada muda pra mim
    expect((await hiddenIdsFor(silenciei.id)).blocked).toEqual([]);
    expect(await unmute(me.id, silenciei.id)).toBe(true);
    expect((await hiddenIdsFor(me.id)).muted).toEqual([]);
  });

  it("listMySafety: bloqueados e silenciados com @ e nome, mais recente primeiro", async () => {
    const me = await member();
    const b1 = await member();
    const b2 = await member();
    const s1 = await member();
    await db.prepare("INSERT INTO member_blocks (memberId, blockedId, createdAt) VALUES (?, ?, '2026-10-01 10:00:00')").run(me.id, b1.id);
    await db.prepare("INSERT INTO member_blocks (memberId, blockedId, createdAt) VALUES (?, ?, '2026-10-02 10:00:00')").run(me.id, b2.id);
    await mute(me.id, s1.id);
    const l = await listMySafety(me.id);
    expect(l.blocked.map((p) => p.username)).toEqual([b2.username, b1.username]);
    expect(l.muted.map((p) => p.username)).toEqual([s1.username]);
    expect(l.blocked[0]).toMatchObject({ name: `Pessoa ${b2.username.slice(2)}` });
    expect(await listMySafety(b1.id)).toEqual({ blocked: [], muted: [] });
  });

  it("bloquear sem member_follows (seguir pessoa chega na onda 1) não quebra", async () => {
    const a = await member();
    const b = await member();
    const exists = await db.prepare("SELECT to_regclass('member_follows') IS NOT NULL AS ok").get<{ ok: boolean }>();
    expect(Boolean(exists?.ok)).toBe(false);
    expect(await block(a.id, b.id)).toBe(true);
  });
});

describe("o que some da vista", () => {
  it("feed: post de quem eu bloqueei, de quem me bloqueou e de quem silenciei some só pra mim", async () => {
    const me = await member();
    const outro = await member();
    const bloqueado = await member();
    const bloqueador = await member();
    const silenciado = await member();
    await post(bloqueado.id, "post do bloqueado");
    await post(bloqueador.id, "post de quem me bloqueou");
    await post(silenciado.id, "post do silenciado");
    await post(outro.id, "post normal");
    await block(me.id, bloqueado.id);
    await block(bloqueador.id, me.id);
    await mute(me.id, silenciado.id);
    const mine = (await listPosts(50, me.id)).map((p) => p.body);
    expect(mine).toContain("post normal");
    expect(mine).not.toContain("post do bloqueado");
    expect(mine).not.toContain("post de quem me bloqueou");
    expect(mine).not.toContain("post do silenciado");
    // pra outra pessoa e pra quem está deslogado, tudo segue no ar
    const theirs = (await listPosts(50, outro.id)).map((p) => p.body);
    expect(theirs).toEqual(expect.arrayContaining(["post do bloqueado", "post de quem me bloqueou", "post do silenciado"]));
    expect((await listPosts(50, null)).length).toBeGreaterThanOrEqual(4);
    // o silenciado continua vendo meus posts (silêncio é só meu)
    await post(me.id, "meu post");
    expect((await listPosts(50, silenciado.id)).map((p) => p.body)).toContain("meu post");
    expect((await listPosts(50, bloqueado.id)).map((p) => p.body)).not.toContain("meu post");
  });

  it("feed 'minhas comunidades' também esconde o autor silenciado", async () => {
    const me = await member();
    const chato = await member();
    const c = await db.prepare("INSERT INTO communities (slug, name) VALUES ('bq-com', 'Com BQ') RETURNING id").get<{ id: number }>();
    await db.prepare("INSERT INTO community_members (communityId, memberId) VALUES (?, ?), (?, ?)").run(c!.id, me.id, c!.id, chato.id);
    await post(chato.id, "post no mural", c!.id);
    expect((await listCommunityUpdates(me.id)).some((u) => u.body === "post no mural")).toBe(true);
    await mute(me.id, chato.id);
    expect((await listCommunityUpdates(me.id)).some((u) => u.body === "post no mural")).toBe(false);
  });

  it("notificações de quem eu silenciei ou bloqueei somem da lista e da contagem", async () => {
    const me = await member();
    const chato = await member();
    const ok = await member();
    await notify(me.id, { type: "like", actorUsername: chato.username, text: "curtiu", href: "/feed" });
    await notify(me.id, { type: "like", actorUsername: ok.username, text: "curtiu também", href: "/feed" });
    expect(await unreadCount(me.id)).toBe(2);
    await mute(me.id, chato.id);
    expect((await listNotifications(me.id)).map((n) => n.actorUsername)).toEqual([ok.username]);
    expect(await unreadCount(me.id)).toBe(1);
    await unmute(me.id, chato.id);
    await block(chato.id, me.id);
    expect((await listNotifications(me.id)).map((n) => n.actorUsername)).toEqual([ok.username]);
    expect(await unreadCount(me.id)).toBe(1);
  });

  it("quem foi silenciado ou bloqueado troca o @ e as notificações antigas continuam escondidas", async () => {
    const me = await member();
    const chato = await member();
    const bloqueado = await member();
    await notify(me.id, { type: "like", actorUsername: chato.username, text: "curtiu", href: "/feed" });
    await notify(me.id, { type: "comment", actorUsername: bloqueado.username, text: "comentou", href: "/feed" });
    await mute(me.id, chato.id);
    await block(me.id, bloqueado.id);
    expect(await unreadCount(me.id)).toBe(0);
    await changeUsername(chato.id, `novo_${chato.username}`);
    await changeUsername(bloqueado.id, `novo_${bloqueado.username}`);
    expect(await unreadCount(me.id)).toBe(0);
    expect(await listNotifications(me.id)).toEqual([]);
    // com o @ novo também não passa
    await notify(me.id, { type: "like", actorUsername: `novo_${chato.username}`, text: "curtiu de novo", href: "/feed" });
    expect(await unreadCount(me.id)).toBe(0);
    await unmute(me.id, chato.id);
    expect((await listNotifications(me.id)).map((n) => n.text).sort()).toEqual(["curtiu", "curtiu de novo"]);
  });
});

describe("LGPD", () => {
  it("excluir a conta apaga os bloqueios e silêncios da pessoa; o export de quem foi bloqueado não revela quem bloqueou", async () => {
    const a = await member();
    const b = await member();
    await block(a.id, b.id);
    await mute(a.id, b.id);
    const exp = await exportMemberData(b.id);
    expect(Object.keys(exp!.data).some((k) => k.startsWith("member_blocks") || k.startsWith("member_mutes"))).toBe(false);
    const own = await exportMemberData(a.id);
    expect(own!.data["member_blocks.memberId"]).toHaveLength(1);
    await deleteMemberData(a.id);
    expect(await isBlockedEither(a.id, b.id)).toBe(false);
    expect((await hiddenIdsFor(b.id)).blocked).toEqual([]);
    const left = await db.prepare("SELECT COUNT(*) n FROM member_mutes WHERE memberId = ?").get<{ n: number }>(a.id);
    expect(Number(left?.n)).toBe(0);
  });
});
