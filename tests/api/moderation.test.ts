import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";

// moderação — spec 018: autor ou admin apaga; guards 401 → 404 → 403.
const clerk = vi.hoisted(() => ({ uid: "clerk_mod_author" as string | null }));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: clerk.uid })),
  currentUser: vi.fn(async () => null),
}));

function memberId(clerkId: string, role: "member" | "admin" = "member"): number {
  db.prepare(
    "INSERT OR IGNORE INTO members (clerkId, username, email) VALUES (?, ?, ?)",
  ).run(clerkId, `u_${clerkId}`, `${clerkId}@t.dev`);
  if (role === "admin") {
    db.prepare("UPDATE members SET role = 'admin' WHERE clerkId = ?").run(
      clerkId,
    );
  }
  return (
    db.prepare("SELECT id FROM members WHERE clerkId = ?").get(clerkId) as {
      id: number;
    }
  ).id;
}

const del = () => new Request("http://t", { method: "DELETE" });

const count = (sql: string, ...args: number[]) =>
  (db.prepare(sql).get(...args) as { n: number }).n;

let authorId: number;
let postId: number;

function seedPost(memberId: number, body = "post alvo"): number {
  db.prepare("INSERT INTO posts (memberId, body) VALUES (?, ?)").run(
    memberId,
    body,
  );
  return (
    db
      .prepare(
        "SELECT id FROM posts WHERE memberId = ? ORDER BY id DESC LIMIT 1",
      )
      .get(memberId) as { id: number }
  ).id;
}

function seedComment(pid: number, memberId: number, body = "alvo"): number {
  db.prepare(
    "INSERT INTO post_comments (postId, memberId, body) VALUES (?, ?, ?)",
  ).run(pid, memberId, body);
  return (
    db
      .prepare(
        "SELECT id FROM post_comments WHERE postId = ? ORDER BY id DESC LIMIT 1",
      )
      .get(pid) as { id: number }
  ).id;
}

beforeEach(() => {
  clerk.uid = "clerk_mod_author";
  authorId = memberId("clerk_mod_author");
  postId = seedPost(authorId);
});

describe("DELETE /api/posts/[id]", () => {
  it("401 — deslogado e clerkId sem member provisionado", async () => {
    const { DELETE } = await import("@/app/api/posts/[id]/route");
    clerk.uid = null;
    const anon = await DELETE(del(), {
      params: Promise.resolve({ id: String(postId) }),
    });
    expect(anon.status).toBe(401);

    clerk.uid = "ghost_mod";
    const ghost = await DELETE(del(), {
      params: Promise.resolve({ id: String(postId) }),
    });
    expect(ghost.status).toBe(401);
  });

  it("404 — post inexistente ou id inválido", async () => {
    const { DELETE } = await import("@/app/api/posts/[id]/route");
    const nf = await DELETE(del(), {
      params: Promise.resolve({ id: "999999" }),
    });
    expect(nf.status).toBe(404);
    const bad = await DELETE(del(), {
      params: Promise.resolve({ id: "abc" }),
    });
    expect(bad.status).toBe(404);
  });

  it("403 — membro comum não apaga post alheio", async () => {
    const { DELETE } = await import("@/app/api/posts/[id]/route");
    clerk.uid = "clerk_mod_stranger";
    memberId("clerk_mod_stranger");
    const res = await DELETE(del(), {
      params: Promise.resolve({ id: String(postId) }),
    });
    expect(res.status).toBe(403);
    expect(count("SELECT COUNT(*) n FROM posts WHERE id = ?", postId)).toBe(1);
  });

  it("200 — autor apaga o próprio post com cascata", async () => {
    const { DELETE } = await import("@/app/api/posts/[id]/route");
    const liker = memberId("clerk_mod_liker");
    db.prepare("INSERT INTO likes (postId, memberId) VALUES (?, ?)").run(
      postId,
      liker,
    );
    seedComment(postId, liker);

    const res = await DELETE(del(), {
      params: Promise.resolve({ id: String(postId) }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(count("SELECT COUNT(*) n FROM posts WHERE id = ?", postId)).toBe(0);
    expect(count("SELECT COUNT(*) n FROM likes WHERE postId = ?", postId)).toBe(0);
    expect(
      count("SELECT COUNT(*) n FROM post_comments WHERE postId = ?", postId),
    ).toBe(0);
  });

  it("200 — admin apaga post de terceiro", async () => {
    const { DELETE } = await import("@/app/api/posts/[id]/route");
    clerk.uid = "clerk_mod_admin";
    memberId("clerk_mod_admin", "admin");
    const res = await DELETE(del(), {
      params: Promise.resolve({ id: String(postId) }),
    });
    expect(res.status).toBe(200);
    expect(count("SELECT COUNT(*) n FROM posts WHERE id = ?", postId)).toBe(0);
  });

  it("404 — deleção repetida (idempotente pro client, não-crash)", async () => {
    const { DELETE } = await import("@/app/api/posts/[id]/route");
    const first = await DELETE(del(), {
      params: Promise.resolve({ id: String(postId) }),
    });
    expect(first.status).toBe(200);
    const again = await DELETE(del(), {
      params: Promise.resolve({ id: String(postId) }),
    });
    expect(again.status).toBe(404);
  });
});

describe("DELETE /api/posts/[id]/comments/[commentId]", () => {
  let commentId: number;

  beforeEach(() => {
    commentId = seedComment(postId, authorId);
  });

  const call = async (pid: number | string, cid: number | string) => {
    const { DELETE } = await import(
      "@/app/api/posts/[id]/comments/[commentId]/route"
    );
    return DELETE(del(), {
      params: Promise.resolve({ id: String(pid), commentId: String(cid) }),
    });
  };

  it("401 — deslogado e clerkId sem member provisionado", async () => {
    clerk.uid = null;
    expect((await call(postId, commentId)).status).toBe(401);
    clerk.uid = "ghost_mod2";
    expect((await call(postId, commentId)).status).toBe(401);
  });

  it("404 — comment inexistente, id inválido ou de outro post", async () => {
    expect((await call(postId, 999999)).status).toBe(404);
    expect((await call(postId, "abc")).status).toBe(404);
    expect((await call("abc", commentId)).status).toBe(404);
    // comentário existe mas é de outro post → a URL não bate → 404
    const otherPost = seedPost(authorId, "outro post");
    expect((await call(otherPost, commentId)).status).toBe(404);
    expect(
      count("SELECT COUNT(*) n FROM post_comments WHERE id = ?", commentId),
    ).toBe(1);
  });

  it("403 — membro comum não apaga comentário alheio (nem dono do post)", async () => {
    clerk.uid = "clerk_mod_stranger2";
    memberId("clerk_mod_stranger2");
    expect((await call(postId, commentId)).status).toBe(403);
    // dono do post também não pode — só autor do comentário ou admin
    const other = memberId("clerk_mod_commenter");
    const foreign = seedComment(postId, other);
    expect((await call(postId, foreign)).status).toBe(403);
    expect(
      count("SELECT COUNT(*) n FROM post_comments WHERE id = ?", foreign),
    ).toBe(1);
  });

  it("200 — autor do comentário apaga", async () => {
    const res = await call(postId, commentId);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(
      count("SELECT COUNT(*) n FROM post_comments WHERE id = ?", commentId),
    ).toBe(0);
  });

  it("200 — admin apaga comentário alheio", async () => {
    clerk.uid = "clerk_mod_admin2";
    memberId("clerk_mod_admin2", "admin");
    expect((await call(postId, commentId)).status).toBe(200);
    expect(
      count("SELECT COUNT(*) n FROM post_comments WHERE id = ?", commentId),
    ).toBe(0);
  });
});
