import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { block } from "@/lib/blocks";
import { changeUsername } from "@/lib/members";
import {
  encodeFollowCursor,
  followMember,
  followingIds,
  followsMe,
  isFollowingMember,
  listFollowers,
  listFollowing,
  notifyNewFollower,
  ownCounts,
  parseFollowCursor,
  teammatesToFollow,
  unfollowMember,
} from "@/lib/memberFollows";
import { deleteMemberData, exportMemberData } from "@/lib/privacy";
import { RATE_LIMITS, resetRateLimits } from "@/lib/ratelimit";

// Seguir pessoa (migration 033): rota (401/404/400/429, idempotente,
// bloqueio igual a "não existe"), notificação única por par em 7 dias mesmo
// trocando de @, listas e números só do dono, bloqueio e LGPD.

const clerk = vi.hoisted(() => ({ uid: null as string | null }));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: clerk.uid })),
  currentUser: vi.fn(async () => null),
}));

const HACK = "hack-inova-alphaville-2026"; // seedado no bootstrap do db

let seq = 0;
type M = { id: number; clerkId: string; username: string };
async function member(): Promise<M> {
  const tag = `sp${seq++}`;
  const row = await db
    .prepare("INSERT INTO members (clerkId, username, email, name, headline) VALUES (?, ?, ?, ?, ?) RETURNING id")
    .get<{ id: number }>(`clerk_${tag}`, `u_${tag}`, `${tag}@t.dev`, `Pessoa ${tag}`, `faz ${tag}`);
  return { id: row!.id, clerkId: `clerk_${tag}`, username: `u_${tag}` };
}
async function team(usernames: string[]) {
  const t = await db
    .prepare("INSERT INTO teams (hackathonId, name) VALUES (?, ?) RETURNING id")
    .get<{ id: number }>(HACK, `Time ${seq++}`);
  for (const u of usernames) await db.prepare("INSERT INTO team_members (teamId, username) VALUES (?, ?)").run(t!.id, u);
  return t!.id;
}
const as = (m: { clerkId: string } | null) => {
  clerk.uid = m?.clerkId ?? null;
};
const req = (method: string) => new Request("http://t", { method });
const ctx = (username: string) => ({ params: Promise.resolve({ username }) });
const route = () => import("@/app/api/members/[username]/follow/route");
const followNotifs = async (to: number) =>
  db.prepare("SELECT text, href, actorId FROM notifications WHERE memberId = ? AND type = 'follow' ORDER BY id").all<{
    text: string;
    href: string;
    actorId: number;
  }>(to);
const rows = async (a: number) =>
  db.prepare("SELECT memberId, followedId FROM member_follows WHERE memberId = ? OR followedId = ? ORDER BY memberId, followedId").all(a, a);

beforeEach(() => {
  resetRateLimits();
  as(null);
});

describe("POST/DELETE /api/members/[username]/follow", () => {
  it("401 deslogado, 404 quem não existe ou excluiu a conta, 400 a si mesmo", async () => {
    const { POST, DELETE } = await route();
    const a = await member();
    const b = await member();
    const r401 = await POST(req("POST"), ctx(b.username));
    expect(r401.status).toBe(401);
    expect(await r401.json()).toEqual({ error: "Unauthorized" });
    expect((await DELETE(req("DELETE"), ctx(b.username))).status).toBe(401);

    as(a);
    expect((await POST(req("POST"), ctx("nao_existe"))).status).toBe(404);
    const saiu = await member();
    await deleteMemberData(saiu.id);
    expect((await POST(req("POST"), ctx(`removido-${saiu.id}`))).status).toBe(404);
    const self = await POST(req("POST"), ctx(a.username));
    expect(self.status).toBe(400);
    expect(await self.json()).toEqual({ error: "Você não pode seguir a si mesmo" });
    expect(await rows(a.id)).toEqual([]);
  });

  it("segue, repete sem erro, deixa de seguir; B recebe uma notificação com actorId", async () => {
    const { POST, DELETE } = await route();
    const a = await member();
    const b = await member();
    as(a);
    const r = await POST(req("POST"), ctx(b.username));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ following: true });
    expect(await (await POST(req("POST"), ctx(b.username))).json()).toEqual({ following: true });
    expect(await isFollowingMember(a.id, b.id)).toBe(true);
    expect(await followsMe(b.id, a.id)).toBe(true);
    expect(await followsMe(a.id, b.id)).toBe(false);
    expect(await followNotifs(b.id)).toEqual([{ text: `@${a.username} começou a seguir você`, href: `/u/${a.username}`, actorId: a.id }]);

    expect(await (await DELETE(req("DELETE"), ctx(b.username))).json()).toEqual({ following: false });
    expect(await (await DELETE(req("DELETE"), ctx(b.username))).json()).toEqual({ following: false });
    expect(await isFollowingMember(a.id, b.id)).toBe(false);
  });

  it("aceita @ com maiúscula e o @ antigo (redirect)", async () => {
    const { POST } = await route();
    const a = await member();
    const b = await member();
    as(a);
    expect((await POST(req("POST"), ctx(b.username.toUpperCase()))).status).toBe(200);
    const c = await member();
    const old = c.username;
    await changeUsername(c.id, `novo_${c.id}`);
    expect((await POST(req("POST"), ctx(old))).status).toBe(200);
    expect(await followingIds(a.id)).toEqual([b.id, c.id].sort((x, y) => x - y));
  });

  it("deixar de seguir e seguir de novo em 7 dias não notifica de novo, mesmo trocando de @", async () => {
    const { POST, DELETE } = await route();
    const a = await member();
    const b = await member();
    as(a);
    await POST(req("POST"), ctx(b.username));
    await DELETE(req("DELETE"), ctx(b.username));
    await POST(req("POST"), ctx(b.username));
    expect(await followNotifs(b.id)).toHaveLength(1);

    await DELETE(req("DELETE"), ctx(b.username));
    await changeUsername(a.id, `outro_${a.id}`);
    await POST(req("POST"), ctx(b.username));
    expect(await followNotifs(b.id)).toHaveLength(1);

    // passada a semana, um novo seguir avisa de novo
    await db.prepare("UPDATE notifications SET createdAt = sqlite_now('-8 days') WHERE memberId = ?").run(b.id);
    await DELETE(req("DELETE"), ctx(b.username));
    await POST(req("POST"), ctx(b.username));
    const n = await followNotifs(b.id);
    expect(n).toHaveLength(2);
    expect(n[1]).toEqual({ text: `@outro_${a.id} começou a seguir você`, href: `/u/outro_${a.id}`, actorId: a.id });
  });

  it("bloqueio em qualquer sentido: 404 igual a quem não existe e o seguir some", async () => {
    const { POST, DELETE } = await route();
    const a = await member();
    const b = await member();
    const c = await member();
    as(a);
    await POST(req("POST"), ctx(b.username));
    as(b);
    await POST(req("POST"), ctx(a.username));
    // b bloqueia a: os dois seguir somem
    await block(b.id, a.id);
    expect(await rows(a.id)).toEqual([]);
    as(a);
    const r = await POST(req("POST"), ctx(b.username));
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual(await (await POST(req("POST"), ctx("nao_existe"))).json());
    expect((await DELETE(req("DELETE"), ctx(b.username))).status).toBe(404);
    // a bloqueia c: quem bloqueou também não segue
    await block(a.id, c.id);
    expect((await POST(req("POST"), ctx(c.username))).status).toBe(404);
    expect(await rows(a.id)).toEqual([]);
    // na lib: bloqueado vira 'blocked', a si mesmo 'self'
    expect(await followMember(a.id, b.id)).toBe("blocked");
    expect(await followMember(a.id, a.id)).toBe("self");
  });

  it("60 por hora somando seguir e deixar de seguir; depois 429 com Retry-After", async () => {
    expect(RATE_LIMITS["member-follows"].limit).toBe(60);
    const { POST, DELETE } = await route();
    const a = await member();
    const b = await member();
    as(a);
    for (let i = 0; i < 30; i++) {
      expect((await POST(req("POST"), ctx(b.username))).status).toBe(200);
      expect((await DELETE(req("DELETE"), ctx(b.username))).status).toBe(200);
    }
    const r = await POST(req("POST"), ctx(b.username));
    expect(r.status).toBe(429);
    expect(Number(r.headers.get("Retry-After"))).toBeGreaterThan(0);
    // outra pessoa tem o próprio balde
    const c = await member();
    as(c);
    expect((await POST(req("POST"), ctx(b.username))).status).toBe(200);
  });
});

describe("lib/memberFollows", () => {
  it("followMember: ok, already; unfollowMember diz se havia linha", async () => {
    const a = await member();
    const b = await member();
    expect(await followMember(a.id, b.id)).toBe("ok");
    expect(await followMember(a.id, b.id)).toBe("already");
    expect(await unfollowMember(a.id, b.id)).toBe(true);
    expect(await unfollowMember(a.id, b.id)).toBe(false);
  });

  it("listas e números do dono: sem conta excluída nem bloqueada; followedByMe", async () => {
    const dono = await member();
    const f1 = await member();
    const f2 = await member();
    const f3 = await member();
    const g1 = await member();
    await followMember(f1.id, dono.id);
    await followMember(f2.id, dono.id);
    await followMember(f3.id, dono.id);
    await followMember(dono.id, f1.id);
    await followMember(dono.id, g1.id);
    expect(await ownCounts(dono.id)).toEqual({ seguidores: 3, seguindo: 2 });

    // mais novo primeiro (mesmo segundo: desempate pelo id)
    const seg = await listFollowers(dono.id);
    expect(seg.people.map((p) => p.username)).toEqual([f3.username, f2.username, f1.username]);
    expect(seg.people.find((p) => p.id === f1.id)).toMatchObject({ followedByMe: true, headline: `faz ${f1.username.slice(2)}`, name: expect.any(String) });
    expect(seg.people.find((p) => p.id === f2.id)?.followedByMe).toBe(false);
    expect(seg.next).toBeNull();
    const ing = await listFollowing(dono.id);
    expect(ing.people.every((p) => p.followedByMe)).toBe(true);

    await deleteMemberData(f2.id);
    // linha de seguir sobrevivendo a uma corrida: conta excluída e bloqueio somem igual
    await db.prepare("INSERT INTO member_follows (memberId, followedId) VALUES (?, ?)").run(f2.id, dono.id);
    await db.prepare("INSERT INTO member_blocks (memberId, blockedId) VALUES (?, ?)").run(dono.id, f3.id);
    expect((await listFollowers(dono.id)).people.map((p) => p.id)).toEqual([f1.id]);
    expect(await ownCounts(dono.id)).toEqual({ seguidores: 1, seguindo: 2 });
  });

  it("paginação por ?antes= sem repetir nem pular", async () => {
    const dono = await member();
    const fans: M[] = [];
    for (let i = 0; i < 5; i++) fans.push(await member());
    for (const [i, f] of fans.entries()) {
      await db
        .prepare("INSERT INTO member_follows (memberId, followedId, createdAt) VALUES (?, ?, ?)")
        .run(f.id, dono.id, i < 3 ? "2026-10-01 10:00:00" : `2026-10-0${i} 10:00:00`);
    }
    const p1 = await listFollowers(dono.id, null, 2);
    expect(p1.people).toHaveLength(2);
    expect(p1.next).not.toBeNull();
    const p2 = await listFollowers(dono.id, p1.next, 2);
    const p3 = await listFollowers(dono.id, p2.next, 2);
    expect(p3.next).toBeNull();
    const all = [...p1.people, ...p2.people, ...p3.people].map((p) => p.id);
    expect(all).toEqual([fans[4].id, fans[3].id, fans[2].id, fans[1].id, fans[0].id]);
    // cursor ruim vale como "do começo"
    expect((await listFollowers(dono.id, "lixo", 2)).people.map((p) => p.id)).toEqual(p1.people.map((p) => p.id));
  });

  it("cursor ida e volta", () => {
    const c = encodeFollowCursor("2026-10-28 13:04:05", 42);
    expect(c).toBe("20261028130405-42");
    expect(parseFollowCursor(c)).toEqual({ at: "2026-10-28 13:04:05", id: 42 });
    expect(parseFollowCursor("2026-10-28")).toBeNull();
    expect(parseFollowCursor(undefined)).toBeNull();
  });

  it("teammatesToFollow: quem fez time comigo e eu ainda não sigo, até 6", async () => {
    const me = await member();
    const t1 = await member();
    const t2 = await member();
    const longe = await member();
    const bloq = await member();
    await team([me.username, t1.username, bloq.username]);
    await team([me.username, t2.username]);
    await team([longe.username]);
    await block(bloq.id, me.id);
    expect((await teammatesToFollow(me.id)).map((p) => p.id)).toEqual([t2.id, t1.id]);
    await followMember(me.id, t2.id);
    expect((await teammatesToFollow(me.id)).map((p) => p.id)).toEqual([t1.id]);
    const many = await member();
    const crew: string[] = [];
    for (let i = 0; i < 8; i++) crew.push((await member()).username);
    await team([many.username, ...crew]);
    expect(await teammatesToFollow(many.id)).toHaveLength(6);
  });

  it("notifyNewFollower não avisa a si mesmo", async () => {
    const a = await member();
    expect(await notifyNewFollower(a, a.id)).toBe(false);
    expect(await followNotifs(a.id)).toEqual([]);
  });
});

describe("LGPD", () => {
  it("B exclui a conta: as linhas com B somem dos dois lados; o export de A traz quem A segue e só a contagem de quem segue A", async () => {
    const a = await member();
    const b = await member();
    const c = await member();
    await followMember(a.id, b.id);
    await followMember(b.id, a.id);
    await followMember(b.id, c.id);
    await followMember(c.id, a.id);
    const exp = await exportMemberData(a.id);
    expect(exp!.data["member_follows.memberId"]).toEqual([expect.objectContaining({ memberId: a.id, followedId: b.id })]);
    expect(exp!.data["member_follows.followedId"]).toEqual({ count: 2 });

    await deleteMemberData(b.id);
    expect(await rows(b.id)).toEqual([]);
    expect(await rows(a.id)).toEqual([{ memberId: c.id, followedId: a.id }]);
    expect(await ownCounts(a.id)).toEqual({ seguidores: 1, seguindo: 0 });
  });
});
