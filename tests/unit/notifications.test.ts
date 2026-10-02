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
function makeMember(): number {
  const tag = `n${seq++}`;
  db.prepare(
    "INSERT INTO members (clerkId, username, email) VALUES (?, ?, ?)",
  ).run(`clerk_${tag}`, `u_${tag}`, `${tag}@t.dev`);
  return (
    db.prepare("SELECT id FROM members WHERE clerkId = ?").get(`clerk_${tag}`) as
      { id: number }
  ).id;
}

function usernameOf(memberId: number): string {
  return (
    db.prepare("SELECT username FROM members WHERE id = ?").get(memberId) as {
      username: string;
    }
  ).username;
}

describe("notify", () => {
  it("cria notificação não lida com texto, tipo, ator e href", () => {
    const m = makeMember();
    notify(m, {
      type: "like",
      actorUsername: "ana",
      text: "@ana curtiu teu post",
      href: "/feed",
    });
    const [n] = listNotifications(m);
    expect(n.type).toBe("like");
    expect(n.actorUsername).toBe("ana");
    expect(n.text).toBe("@ana curtiu teu post");
    expect(n.href).toBe("/feed");
    expect(n.read).toBe(false);
    expect(unreadCount(m)).toBe(1);
  });

  it("nunca notifica a si mesmo — ator == destinatário é skip", () => {
    const m = makeMember();
    notify(m, {
      type: "like",
      actorUsername: usernameOf(m),
      text: "curtiu o próprio post",
      href: "/feed",
    });
    expect(listNotifications(m)).toHaveLength(0);
    expect(unreadCount(m)).toBe(0);
  });

  it("ator opcional — notificação de sistema entra sem actorUsername", () => {
    const m = makeMember();
    notify(m, { type: "system", text: "bem-vinda ao hackahub" });
    const [n] = listNotifications(m);
    expect(n.actorUsername).toBeNull();
    expect(n.href).toBeNull();
  });
});

describe("listNotifications", () => {
  it("ordena da mais recente pra mais antiga e isola por membro", () => {
    const a = makeMember();
    const b = makeMember();
    notify(a, { type: "like", actorUsername: "x", text: "primeira" });
    notify(a, { type: "comment", actorUsername: "x", text: "segunda" });
    notify(b, { type: "like", actorUsername: "x", text: "de outro membro" });
    const list = listNotifications(a);
    expect(list.map((n) => n.text)).toEqual(["segunda", "primeira"]);
    expect(list.every((n) => n.memberId === a)).toBe(true);
    expect(listNotifications(b)).toHaveLength(1);
  });

  it("respeita o limit (default 50, mas aceita menor)", () => {
    const m = makeMember();
    for (let i = 0; i < 5; i++) {
      notify(m, { type: "like", actorUsername: "x", text: `n${i}` });
    }
    expect(listNotifications(m, 3)).toHaveLength(3);
    expect(listNotifications(m)).toHaveLength(5);
  });
});

describe("markRead / markAllRead", () => {
  it("markRead marca uma notificação e baixa o unread", () => {
    const m = makeMember();
    notify(m, { type: "like", actorUsername: "x", text: "a" });
    notify(m, { type: "like", actorUsername: "x", text: "b" });
    const [latest] = listNotifications(m);
    markRead(latest.id, m);
    const after = listNotifications(m);
    expect(after.find((n) => n.id === latest.id)?.read).toBe(true);
    expect(after.find((n) => n.id !== latest.id)?.read).toBe(false);
    expect(unreadCount(m)).toBe(1);
  });

  it("markRead é escopado por memberId — não lê caixa dos outros", () => {
    const a = makeMember();
    const b = makeMember();
    notify(b, { type: "like", actorUsername: "x", text: "do b" });
    const [victim] = listNotifications(b);
    markRead(victim.id, a); // A tenta marcar notificação de B
    expect(listNotifications(b)[0].read).toBe(false);
    expect(unreadCount(b)).toBe(1);
  });

  it("markAllRead zera o unread sem apagar o histórico", () => {
    const m = makeMember();
    notify(m, { type: "like", actorUsername: "x", text: "a" });
    notify(m, { type: "comment", actorUsername: "x", text: "b" });
    markAllRead(m);
    expect(unreadCount(m)).toBe(0);
    const list = listNotifications(m);
    expect(list).toHaveLength(2);
    expect(list.every((n) => n.read)).toBe(true);
  });
});
