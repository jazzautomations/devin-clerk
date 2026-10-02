import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";
import { listNotifications, notify, unreadCount } from "@/lib/notifications";

const clerk = vi.hoisted(() => ({ uid: "clerk_na" as string | null }));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: clerk.uid })),
  currentUser: vi.fn(async () => null),
}));

let seq = 0;
function memberId(tag?: string): number {
  const clerkId = tag ?? `clerk_nm${seq++}`;
  db.prepare(
    "INSERT OR IGNORE INTO members (clerkId, username, email) VALUES (?, ?, ?)",
  ).run(clerkId, `u_${clerkId}`, `${clerkId}@t.dev`);
  return (
    db.prepare("SELECT id FROM members WHERE clerkId = ?").get(clerkId) as {
      id: number;
    }
  ).id;
}

function usernameOf(id: number): string {
  return (
    db.prepare("SELECT username FROM members WHERE id = ?").get(id) as {
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

function notificationsOf(member: number) {
  return db
    .prepare(
      "SELECT * FROM notifications WHERE memberId = ? ORDER BY id DESC",
    )
    .all(member) as { type: string; text: string; read: number }[];
}

beforeEach(() => {
  clerk.uid = "clerk_na";
  db.prepare("DELETE FROM notifications").run();
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
    const a = memberId("clerk_na");
    const b = memberId();
    notify(a, { type: "like", actorUsername: "x", text: "pro a" });
    notify(b, { type: "like", actorUsername: "x", text: "pro b" });

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
    const a = memberId("clerk_na");
    notify(a, { type: "like", actorUsername: "x", text: "a" });
    notify(a, { type: "comment", actorUsername: "x", text: "b" });

    const res = await POST(postReq({ action: "readAll" }));
    expect(res.status).toBe(200);
    expect(unreadCount(a)).toBe(0);

    const get = await GET();
    const body = await get.json();
    expect(body.unread).toBe(0);
    expect(body.notifications).toHaveLength(2);
  });

  it("{id} marca uma só — e não lê notificação de outro membro", async () => {
    const { POST } = await import("@/app/api/notifications/route");
    const a = memberId("clerk_na");
    const b = memberId();
    notify(a, { type: "like", actorUsername: "x", text: "do a" });
    notify(b, { type: "like", actorUsername: "x", text: "do b" });
    const [mine] = listNotifications(a);
    const [theirs] = listNotifications(b);

    const res = await POST(postReq({ id: mine.id }));
    expect(res.status).toBe(200);
    expect(listNotifications(a)[0].read).toBe(true);

    // id dos outros não faz nada — e nem devolve erro vazando existência
    const res2 = await POST(postReq({ id: theirs.id }));
    expect(res2.status).toBe(200);
    expect(listNotifications(b)[0].read).toBe(false);
  });

  it("400 — body inválido", async () => {
    const { POST } = await import("@/app/api/notifications/route");
    memberId("clerk_na");
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
  function seedPost(authorTag: string): number {
    const author = memberId(authorTag);
    db.prepare("INSERT INTO posts (memberId, body) VALUES (?, 'post alvo')").run(
      author,
    );
    return (
      db
        .prepare(
          "SELECT id FROM posts WHERE memberId = ? ORDER BY id DESC LIMIT 1",
        )
        .get(author) as { id: number }
    ).id;
  }

  it("like no post de outro notifica o autor; unlike não notifica", async () => {
    const { POST: like } = await import("@/app/api/posts/[id]/like/route");
    const postId = seedPost("clerk_author");
    const author = memberId("clerk_author");
    clerk.uid = "clerk_liker";
    memberId("clerk_liker");

    const res = await like(new Request("http://t", { method: "POST" }), {
      params: Promise.resolve({ id: String(postId) }),
    });
    expect(res.status).toBe(200);
    const notes = notificationsOf(author);
    expect(notes).toHaveLength(1);
    expect(notes[0].type).toBe("like");
    expect(notes[0].text).toBe("@u_clerk_liker curtiu teu post");
    expect(notes[0].read).toBe(0);

    // toggle de novo = unlike — nenhuma notificação nova
    await like(new Request("http://t", { method: "POST" }), {
      params: Promise.resolve({ id: String(postId) }),
    });
    expect(notificationsOf(author)).toHaveLength(1);
  });

  it("like no próprio post não notifica", async () => {
    const { POST: like } = await import("@/app/api/posts/[id]/like/route");
    const postId = seedPost("clerk_na");
    const self = memberId("clerk_na");

    const res = await like(new Request("http://t", { method: "POST" }), {
      params: Promise.resolve({ id: String(postId) }),
    });
    expect(res.status).toBe(200);
    expect(notificationsOf(self)).toHaveLength(0);
  });

  it("comentário no post de outro notifica o autor", async () => {
    const { POST: comment } = await import(
      "@/app/api/posts/[id]/comments/route"
    );
    const postId = seedPost("clerk_author2");
    const author = memberId("clerk_author2");
    clerk.uid = "clerk_commenter";
    memberId("clerk_commenter");

    const res = await comment(postReq({ body: "ficou massa" }), {
      params: Promise.resolve({ id: String(postId) }),
    });
    expect(res.status).toBe(201);
    const notes = notificationsOf(author);
    expect(notes).toHaveLength(1);
    expect(notes[0].type).toBe("comment");
    expect(notes[0].text).toBe("@u_clerk_commenter comentou no teu post");
  });

  it("comentário no próprio post não notifica", async () => {
    const { POST: comment } = await import(
      "@/app/api/posts/[id]/comments/route"
    );
    const postId = seedPost("clerk_na");
    const self = memberId("clerk_na");

    const res = await comment(postReq({ body: "eu mesmo" }), {
      params: Promise.resolve({ id: String(postId) }),
    });
    expect(res.status).toBe(201);
    expect(notificationsOf(self)).toHaveLength(0);
  });

  it("notificação usa actorUsername congelado, não o do destinatário", async () => {
    const { POST: like } = await import("@/app/api/posts/[id]/like/route");
    const postId = seedPost("clerk_author3");
    const author = memberId("clerk_author3");
    clerk.uid = "clerk_liker2";
    const liker = memberId("clerk_liker2");

    await like(new Request("http://t", { method: "POST" }), {
      params: Promise.resolve({ id: String(postId) }),
    });
    const [n] = listNotifications(author);
    expect(n.actorUsername).toBe(usernameOf(liker));
    expect(n.href).toBe("/feed");
  });
});
