import { describe, expect, it } from "vitest";
import db from "@/lib/db";
import { createComment, listComments } from "@/lib/comments";
import { createPost, listPosts } from "@/lib/posts";

function makeMember(clerkId: string): number {
  db.prepare(
    "INSERT INTO members (clerkId, username, email) VALUES (?, ?, ?)",
  ).run(clerkId, `u_${clerkId}`, `${clerkId}@t.dev`);
  return (
    db.prepare("SELECT id FROM members WHERE clerkId = ?").get(clerkId) as {
      id: number;
    }
  ).id;
}

describe("comments", () => {
  it("cria comentário com trim e retorna autor via join", () => {
    const m = makeMember("c1");
    const post = createPost(m, "deploy no ar");
    const c = createComment(post.id, m, "  ficou ótimo  ");
    expect(c.body).toBe("ficou ótimo");
    expect(c.postId).toBe(post.id);
    expect(c.username).toBe("u_c1");
  });

  it("rejeita vazio, só espaços e >1000 chars", () => {
    const m = makeMember("c2");
    const post = createPost(m, "demo");
    expect(() => createComment(post.id, m, "")).toThrow();
    expect(() => createComment(post.id, m, "   ")).toThrow();
    expect(() => createComment(post.id, m, "x".repeat(1001))).toThrow();
    // exatamente 1000 passa
    expect(createComment(post.id, m, "x".repeat(1000)).body).toHaveLength(1000);
  });

  it("lista ASC por createdAt/id e isola por post", () => {
    const a = makeMember("c3");
    const b = makeMember("c4");
    const p1 = createPost(a, "post um");
    const p2 = createPost(a, "post dois");
    createComment(p1.id, b, "primeiro");
    createComment(p1.id, a, "segundo");
    createComment(p2.id, b, "outro post");
    const thread = listComments(p1.id);
    expect(thread.map((c) => c.body)).toEqual(["primeiro", "segundo"]);
    expect(thread[0].username).toBe("u_c4");
    expect(listComments(p2.id)).toHaveLength(1);
  });

  it("comentário carrega persona e xp do autor", () => {
    const m = makeMember("c5");
    db.prepare("UPDATE members SET xp = 150, persona = 'dev' WHERE id = ?").run(
      m,
    );
    const post = createPost(m, "demo");
    createComment(post.id, m, "com xp");
    const [c] = listComments(post.id);
    expect(c.xp).toBe(150);
    expect(c.persona).toBe("dev");
  });

  it("listPosts expõe commentCount sem N+1", () => {
    const m = makeMember("c6");
    const post = createPost(m, "contando");
    createComment(post.id, m, "um");
    createComment(post.id, m, "dois");
    const found = listPosts(10).find((p) => p.id === post.id);
    expect(found?.commentCount).toBe(2);
    // post recém-criado já sai com 0
    const fresh = createPost(m, "zerado");
    expect(fresh.commentCount).toBe(0);
  });
});
