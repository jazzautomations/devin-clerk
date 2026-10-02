import { beforeEach, describe, expect, it, vi } from "vitest";
import db from "@/lib/db";

const clerk = vi.hoisted(() => ({ uid: "clerk_commenter" as string | null }));

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: clerk.uid })),
  currentUser: vi.fn(async () => null),
}));

function memberId(clerkId: string): number {
  db.prepare(
    "INSERT OR IGNORE INTO members (clerkId, username, email) VALUES (?, ?, ?)",
  ).run(clerkId, `u_${clerkId}`, `${clerkId}@t.dev`);
  return (
    db.prepare("SELECT id FROM members WHERE clerkId = ?").get(clerkId) as {
      id: number;
    }
  ).id;
}

const postReq = (body: unknown) =>
  new Request("http://t", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

let postId: number;

beforeEach(() => {
  clerk.uid = "clerk_commenter";
  const m = memberId("clerk_commenter");
  db.prepare("DELETE FROM post_comments").run();
  db.prepare("INSERT INTO posts (memberId, body) VALUES (?, 'post alvo')").run(
    m,
  );
  postId = (
    db
      .prepare(
        "SELECT id FROM posts WHERE memberId = ? ORDER BY id DESC LIMIT 1",
      )
      .get(m) as { id: number }
  ).id;
});

describe("GET /api/posts/[id]/comments — público", () => {
  it("retorna thread ASC sem login; 404 post inexistente e id inválido", async () => {
    const { GET } = await import("@/app/api/posts/[id]/comments/route");
    clerk.uid = null; // leitura é pública
    db.prepare(
      "INSERT INTO post_comments (postId, memberId, body) VALUES (?, ?, 'um'), (?, ?, 'dois')",
    ).run(postId, memberId("clerk_commenter"), postId, memberId("clerk_commenter"));

    const res = await GET(new Request("http://t"), {
      params: Promise.resolve({ id: String(postId) }),
    });
    expect(res.status).toBe(200);
    const { comments } = await res.json();
    expect(comments.map((c: { body: string }) => c.body)).toEqual([
      "um",
      "dois",
    ]);
    expect(comments[0].username).toBe("u_clerk_commenter");

    const nf = await GET(new Request("http://t"), {
      params: Promise.resolve({ id: "999999" }),
    });
    expect(nf.status).toBe(404);
    const bad = await GET(new Request("http://t"), {
      params: Promise.resolve({ id: "abc" }),
    });
    expect(bad.status).toBe(404);
  });
});

describe("POST /api/posts/[id]/comments", () => {
  it("201 — cria comentário com autor e paga +5xp pro comentarista", async () => {
    const { POST } = await import("@/app/api/posts/[id]/comments/route");
    const mid = memberId("clerk_commenter");
    const before = (
      db.prepare("SELECT xp FROM members WHERE id = ?").get(mid) as {
        xp: number;
      }
    ).xp;

    const res = await POST(postReq({ body: "  massa demais  " }), {
      params: Promise.resolve({ id: String(postId) }),
    });
    expect(res.status).toBe(201);
    const { comment } = await res.json();
    expect(comment.body).toBe("massa demais");
    expect(comment.username).toBe("u_clerk_commenter");
    expect(comment.postId).toBe(postId);

    const after = (
      db.prepare("SELECT xp FROM members WHERE id = ?").get(mid) as {
        xp: number;
      }
    ).xp;
    expect(after - before).toBe(5);
  });

  it("400 — vazio, só espaços, >1000 e não-string", async () => {
    const { POST } = await import("@/app/api/posts/[id]/comments/route");
    for (const body of [
      { body: "" },
      { body: "   " },
      { body: "x".repeat(1001) },
      { body: 42 },
      {},
    ]) {
      const res = await POST(postReq(body), {
        params: Promise.resolve({ id: String(postId) }),
      });
      expect(res.status).toBe(400);
    }
    const n = (
      db
        .prepare("SELECT COUNT(*) n FROM post_comments WHERE postId = ?")
        .get(postId) as { n: number }
    ).n;
    expect(n).toBe(0);
  });

  it("404 — post inexistente ou id inválido", async () => {
    const { POST } = await import("@/app/api/posts/[id]/comments/route");
    const nf = await POST(postReq({ body: "oi" }), {
      params: Promise.resolve({ id: "999999" }),
    });
    expect(nf.status).toBe(404);
    const bad = await POST(postReq({ body: "oi" }), {
      params: Promise.resolve({ id: "abc" }),
    });
    expect(bad.status).toBe(404);
  });

  it("401 — deslogado; e 401 — clerkId sem member provisionado", async () => {
    const { POST } = await import("@/app/api/posts/[id]/comments/route");
    clerk.uid = null;
    const anon = await POST(postReq({ body: "oi" }), {
      params: Promise.resolve({ id: String(postId) }),
    });
    expect(anon.status).toBe(401);

    clerk.uid = "ghost_sem_member";
    const ghost = await POST(postReq({ body: "oi" }), {
      params: Promise.resolve({ id: String(postId) }),
    });
    expect(ghost.status).toBe(401);
  });
});

describe("commentCount na listagem", () => {
  it("GET /api/posts traz commentCount por post", async () => {
    const mid = memberId("clerk_commenter");
    db.prepare(
      "INSERT INTO post_comments (postId, memberId, body) VALUES (?, ?, 'x'), (?, ?, 'y'), (?, ?, 'z')",
    ).run(postId, mid, postId, mid, postId, mid);
    const { GET } = await import("@/app/api/posts/route");
    const res = await GET();
    const { posts } = await res.json();
    const found = posts.find((p: { id: number }) => p.id === postId);
    expect(found.commentCount).toBe(3);
  });
});
