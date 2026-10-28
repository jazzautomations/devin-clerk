import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { listNotifications, notify, unreadCount } from "@/lib/notifications";

const clerk = vi.hoisted(() => ({ uid: "clerk_na" as string | null }));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: clerk.uid })),
  currentUser: vi.fn(async () => null),
}));

let seq = 0;
async function memberId(tag?: string): Promise<number> {
  const clerkId = tag ?? `clerk_nm${seq++}`;
  await db.prepare(
    "INSERT OR IGNORE INTO members (clerkId, username, email) VALUES (?, ?, ?)",
  ).run(clerkId, `u_${clerkId}`, `${clerkId}@t.dev`);
  return (
    await db.prepare("SELECT id FROM members WHERE clerkId = ?").get(clerkId) as {
      id: number;
    }
  ).id;
}

async function usernameOf(id: number): Promise<string> {
  return (
    await db.prepare("SELECT username FROM members WHERE id = ?").get(id) as {
      username: string;
    }
  ).username;
}

const postReq = (body: unknown) =>
  new Request("http://t", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

async function notificationsOf(member: number) {
  return await db
    .prepare(
      "SELECT * FROM notifications WHERE memberId = ? ORDER BY id DESC",
    )
    .all(member) as { type: string; text: string; read: number; href: string | null }[];
}

beforeEach(async () => {
  clerk.uid = "clerk_na";
  await db.prepare("DELETE FROM notifications").run();
});

describe("GET /api/notifications", () => {
  it("401 deslogado — JSON, nunca redirect", async () => {
    const { GET } = await import("@/app/api/notifications/route");
    clerk.uid = null;
    const res = await GET();
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  it("401 — clerkId sem member provisionado", async () => {
    const { GET } = await import("@/app/api/notifications/route");
    clerk.uid = "ghost_sem_member";
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("200 — devolve só as do membro logado + unread", async () => {
    const { GET } = await import("@/app/api/notifications/route");
    const a = await memberId("clerk_na");
    const b = await memberId();
    await notify(a, { type: "like", actorUsername: "x", text: "pro a" });
    await notify(b, { type: "like", actorUsername: "x", text: "pro b" });

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.unread).toBe(1);
    expect(body.notifications).toHaveLength(1);
    expect(body.notifications[0].text).toBe("pro a");
    expect(body.notifications[0].read).toBe(false);
  });
});

describe("POST /api/notifications", () => {
  it("readAll marca tudo do membro e devolve ok", async () => {
    const { GET, POST } = await import("@/app/api/notifications/route");
    const a = await memberId("clerk_na");
    await notify(a, { type: "like", actorUsername: "x", text: "a" });
    await notify(a, { type: "comment", actorUsername: "x", text: "b" });

    const res = await POST(postReq({ action: "readAll" }));
    expect(res.status).toBe(200);
    expect(await unreadCount(a)).toBe(0);

    const get = await GET();
    const body = await get.json();
    expect(body.unread).toBe(0);
    expect(body.notifications).toHaveLength(2);
  });

  it("{id} marca uma só — e não lê notificação de outro membro", async () => {
    const { POST } = await import("@/app/api/notifications/route");
    const a = await memberId("clerk_na");
    const b = await memberId();
    await notify(a, { type: "like", actorUsername: "x", text: "do a" });
    await notify(b, { type: "like", actorUsername: "x", text: "do b" });
    const [mine] = await listNotifications(a);
    const [theirs] = await listNotifications(b);

    const res = await POST(postReq({ id: mine.id }));
    expect(res.status).toBe(200);
    expect((await listNotifications(a))[0].read).toBe(true);

    // id dos outros não faz nada — e nem devolve erro vazando existência
    const res2 = await POST(postReq({ id: theirs.id }));
    expect(res2.status).toBe(200);
    expect((await listNotifications(b))[0].read).toBe(false);
  });

  it("400 — body inválido", async () => {
    const { POST } = await import("@/app/api/notifications/route");
    await memberId("clerk_na");
    for (const body of [{}, { action: "nope" }, { id: "x" }, { id: -1 }]) {
      const res = await POST(postReq(body));
      expect(res.status).toBe(400);
    }
  });

  it("401 — deslogado", async () => {
    const { POST } = await import("@/app/api/notifications/route");
    clerk.uid = null;
    const res = await POST(postReq({ action: "readAll" }));
    expect(res.status).toBe(401);
  });
});

describe("gatilhos — like e comentário geram notificação", () => {
  async function seedPost(authorTag: string): Promise<number> {
    const author = await memberId(authorTag);
    await db.prepare("INSERT INTO posts (memberId, body) VALUES (?, 'post alvo')").run(
      author,
    );
    return (
      await db
        .prepare(
          "SELECT id FROM posts WHERE memberId = ? ORDER BY id DESC LIMIT 1",
        )
        .get(author) as { id: number }
    ).id;
  }

  it("reação no post de outro notifica o autor com o link do post; tirar não notifica", async () => {
    const { POST: like } = await import("@/app/api/posts/[id]/like/route");
    const postId = await seedPost("clerk_author");
    const author = await memberId("clerk_author");
    clerk.uid = "clerk_liker";
    await memberId("clerk_liker");

    const res = await like(new Request("http://t", { method: "POST" }), {
      params: Promise.resolve({ id: String(postId) }),
    });
    expect(res.status).toBe(200);
    const notes = await notificationsOf(author);
    expect(notes).toHaveLength(1);
    expect(notes[0].type).toBe("reaction");
    expect(notes[0].text).toBe("@u_clerk_liker reagiu ao seu post: curti");
    expect(notes[0].href).toBe(`/post/${postId}`);
    expect(notes[0].read).toBe(0);

    // tirar a reação — nenhuma notificação nova
    await like(new Request("http://t", { method: "POST", body: JSON.stringify({ kind: null }) }), {
      params: Promise.resolve({ id: String(postId) }),
    });
    expect(await notificationsOf(author)).toHaveLength(1);
  });

  it("reação no próprio post é recusada e não notifica", async () => {
    const { POST: like } = await import("@/app/api/posts/[id]/like/route");
    const postId = await seedPost("clerk_na");
    const self = await memberId("clerk_na");

    const res = await like(new Request("http://t", { method: "POST" }), {
      params: Promise.resolve({ id: String(postId) }),
    });
    expect(res.status).toBe(400);
    expect(await notificationsOf(self)).toHaveLength(0);
  });

  it("comentário no post de outro notifica o autor", async () => {
    const { POST: comment } = await import(
      "@/app/api/posts/[id]/comments/route"
    );
    const postId = await seedPost("clerk_author2");
    const author = await memberId("clerk_author2");
    clerk.uid = "clerk_commenter";
    await memberId("clerk_commenter");

    const res = await comment(postReq({ body: "ficou massa" }), {
      params: Promise.resolve({ id: String(postId) }),
    });
    expect(res.status).toBe(201);
    const notes = await notificationsOf(author);
    expect(notes).toHaveLength(1);
    expect(notes[0].type).toBe("comment");
    expect(notes[0].text).toBe("@u_clerk_commenter comentou no seu post");
  });

  it("comentário no próprio post não notifica", async () => {
    const { POST: comment } = await import(
      "@/app/api/posts/[id]/comments/route"
    );
    const postId = await seedPost("clerk_na");
    const self = await memberId("clerk_na");

    const res = await comment(postReq({ body: "eu mesmo" }), {
      params: Promise.resolve({ id: String(postId) }),
    });
    expect(res.status).toBe(201);
    expect(await notificationsOf(self)).toHaveLength(0);
  });

  it("notificação usa actorUsername congelado, não o do destinatário", async () => {
    const { POST: like } = await import("@/app/api/posts/[id]/like/route");
    const postId = await seedPost("clerk_author3");
    const author = await memberId("clerk_author3");
    clerk.uid = "clerk_liker2";
    const liker = await memberId("clerk_liker2");

    await like(new Request("http://t", { method: "POST" }), {
      params: Promise.resolve({ id: String(postId) }),
    });
    const [n] = await listNotifications(author);
    expect(n.actorUsername).toBe(await usernameOf(liker));
    expect(n.href).toBe(`/post/${postId}`);
  });
});

describe("GET /api/notifications/[id]/open — abrir marca como lida (frente N #3)", () => {
  const openCtx = (id: number | string) => ({ params: Promise.resolve({ id: String(id) }) });

  it("marca a do membro como lida e redireciona pro destino interno", async () => {
    const { GET } = await import("@/app/api/notifications/[id]/open/route");
    const a = await memberId("clerk_na");
    await notify(a, { type: "team_invite", text: "convite", href: "/h/x#meu-time" });
    const [n] = await listNotifications(a);
    expect(await unreadCount(a)).toBe(1);
    const res = await GET(new Request("http://t/api/notifications/1/open"), openCtx(n.id));
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/h/x");
    expect(await unreadCount(a)).toBe(0);
  });

  it("404 pra notificação de outro membro — e ela continua não lida", async () => {
    const { GET } = await import("@/app/api/notifications/[id]/open/route");
    await memberId("clerk_na");
    const b = await memberId();
    await notify(b, { type: "like", text: "do b", href: "/feed" });
    const [n] = await listNotifications(b);
    const res = await GET(new Request("http://t/x"), openCtx(n.id));
    expect(res.status).toBe(404);
    expect(await unreadCount(b)).toBe(1);
    expect((await GET(new Request("http://t/x"), openCtx("abc"))).status).toBe(404);
  });

  it("href externo/protocol-relative nunca vira redirect aberto", async () => {
    const { GET } = await import("@/app/api/notifications/[id]/open/route");
    const a = await memberId("clerk_na");
    await notify(a, { type: "x", text: "malandro", href: "//evil.example/phish" });
    const [n] = await listNotifications(a);
    const res = await GET(new Request("http://t/x"), openCtx(n.id));
    const loc = new URL(res.headers.get("location")!);
    expect(loc.host).toBe("t");
    expect(loc.pathname).toBe("/notificacoes");
  });

  it("401 deslogado", async () => {
    const { GET } = await import("@/app/api/notifications/[id]/open/route");
    clerk.uid = null;
    const res = await GET(new Request("http://t/x"), openCtx(1));
    expect(res.status).toBe(401);
  });
});
