import { describe, expect, it } from "vitest";
import db from "@/lib/db";
import {
  listNotifications,
  markAllRead,
  markRead,
  notify,
  unreadCount,
} from "@/lib/notifications";

let seq = 0;
async function makeMember(): Promise<number> {
  const tag = `n${seq++}`;
  await db.prepare(
    "INSERT INTO members (clerkId, username, email) VALUES (?, ?, ?)",
  ).run(`clerk_${tag}`, `u_${tag}`, `${tag}@t.dev`);
  return (
    await db.prepare("SELECT id FROM members WHERE clerkId = ?").get(`clerk_${tag}`) as
      { id: number }
  ).id;
}

async function usernameOf(memberId: number): Promise<string> {
  return (
    await db.prepare("SELECT username FROM members WHERE id = ?").get(memberId) as {
      username: string;
    }
  ).username;
}

describe("notify", () => {
  it("cria notificação não lida com texto, tipo, ator e href", async () => {
    const m = await makeMember();
    await notify(m, {
      type: "like",
      actorUsername: "ana",
      text: "@ana curtiu teu post",
      href: "/feed",
    });
    const [n] = await listNotifications(m);
    expect(n.type).toBe("like");
    expect(n.actorUsername).toBe("ana");
    expect(n.text).toBe("@ana curtiu teu post");
    expect(n.href).toBe("/feed");
    expect(n.read).toBe(false);
    expect(await unreadCount(m)).toBe(1);
  });

  it("nunca notifica a si mesmo — ator == destinatário é skip", async () => {
    const m = await makeMember();
    await notify(m, {
      type: "like",
      actorUsername: await usernameOf(m),
      text: "curtiu o próprio post",
      href: "/feed",
    });
    expect(await listNotifications(m)).toHaveLength(0);
    expect(await unreadCount(m)).toBe(0);
  });

  it("ator opcional — notificação de sistema entra sem actorUsername", async () => {
    const m = await makeMember();
    await notify(m, { type: "system", text: "bem-vinda ao hackahub" });
    const [n] = await listNotifications(m);
    expect(n.actorUsername).toBeNull();
    expect(n.href).toBeNull();
  });
});

describe("listNotifications", () => {
  it("ordena da mais recente pra mais antiga e isola por membro", async () => {
    const a = await makeMember();
    const b = await makeMember();
    await notify(a, { type: "like", actorUsername: "x", text: "primeira" });
    await notify(a, { type: "comment", actorUsername: "x", text: "segunda" });
    await notify(b, { type: "like", actorUsername: "x", text: "de outro membro" });
    const list = await listNotifications(a);
    expect(list.map((n) => n.text)).toEqual(["segunda", "primeira"]);
    expect(list.every((n) => n.memberId === a)).toBe(true);
    expect(await listNotifications(b)).toHaveLength(1);
  });

  it("respeita o limit (default 50, mas aceita menor)", async () => {
    const m = await makeMember();
    for (let i = 0; i < 5; i++) {
      await notify(m, { type: "like", actorUsername: "x", text: `n${i}` });
    }
    expect(await listNotifications(m, 3)).toHaveLength(3);
    expect(await listNotifications(m)).toHaveLength(5);
  });
});

describe("markRead / markAllRead", () => {
  it("markRead marca uma notificação e baixa o unread", async () => {
    const m = await makeMember();
    await notify(m, { type: "like", actorUsername: "x", text: "a" });
    await notify(m, { type: "like", actorUsername: "x", text: "b" });
    const [latest] = await listNotifications(m);
    await markRead(latest.id, m);
    const after = await listNotifications(m);
    expect(after.find((n) => n.id === latest.id)?.read).toBe(true);
    expect(after.find((n) => n.id !== latest.id)?.read).toBe(false);
    expect(await unreadCount(m)).toBe(1);
  });

  it("markRead é escopado por memberId — não lê caixa dos outros", async () => {
    const a = await makeMember();
    const b = await makeMember();
    await notify(b, { type: "like", actorUsername: "x", text: "do b" });
    const [victim] = await listNotifications(b);
    await markRead(victim.id, a); // A tenta marcar notificação de B
    expect((await listNotifications(b))[0].read).toBe(false);
    expect(await unreadCount(b)).toBe(1);
  });

  it("markAllRead zera o unread sem apagar o histórico", async () => {
    const m = await makeMember();
    await notify(m, { type: "like", actorUsername: "x", text: "a" });
    await notify(m, { type: "comment", actorUsername: "x", text: "b" });
    await markAllRead(m);
    expect(await unreadCount(m)).toBe(0);
    const list = await listNotifications(m);
    expect(list).toHaveLength(2);
    expect(list.every((n) => n.read)).toBe(true);
  });
});
