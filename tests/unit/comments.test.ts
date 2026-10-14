import { describe, expect, it } from "vitest";
import db from "@/lib/db";
import { createComment, listComments } from "@/lib/comments";
import { createPost, listPosts } from "@/lib/posts";

async function makeMember(clerkId: string): Promise<number> {
  await db.prepare(
    "INSERT INTO members (clerkId, username, email) VALUES (?, ?, ?)",
  ).run(clerkId, `u_${clerkId}`, `${clerkId}@t.dev`);
  return (
    await db.prepare("SELECT id FROM members WHERE clerkId = ?").get(clerkId) as {
      id: number;
    }
  ).id;
}

describe("comments", () => {
  it("cria comentário com trim e retorna autor via join", async () => {
    const m = await makeMember("c1");
    const post = await createPost(m, "deploy no ar");
    const c = await createComment(post.id, m, "  ficou ótimo  ");
    expect(c.body).toBe("ficou ótimo");
    expect(c.postId).toBe(post.id);
    expect(c.username).toBe("u_c1");
  });

  it("rejeita vazio, só espaços e >1000 chars", async () => {
    const m = await makeMember("c2");
    const post = await createPost(m, "demo");
    await expect(createComment(post.id, m, "")).rejects.toThrow();
    await expect(createComment(post.id, m, "   ")).rejects.toThrow();
    await expect(createComment(post.id, m, "x".repeat(1001))).rejects.toThrow();
    // exatamente 1000 passa
    expect((await createComment(post.id, m, "x".repeat(1000))).body).toHaveLength(1000);
  });

  it("lista ASC por createdAt/id e isola por post", async () => {
    const a = await makeMember("c3");
    const b = await makeMember("c4");
    const p1 = await createPost(a, "post um");
    const p2 = await createPost(a, "post dois");
    await createComment(p1.id, b, "primeiro");
    await createComment(p1.id, a, "segundo");
    await createComment(p2.id, b, "outro post");
    const thread = await listComments(p1.id);
    expect(thread.map((c) => c.body)).toEqual(["primeiro", "segundo"]);
    expect(thread[0].username).toBe("u_c4");
    expect(await listComments(p2.id)).toHaveLength(1);
  });

  it("comentário carrega persona e xp do autor", async () => {
    const m = await makeMember("c5");
    await db.prepare("UPDATE members SET xp = 150, persona = 'dev' WHERE id = ?").run(
      m,
    );
    const post = await createPost(m, "demo");
    await createComment(post.id, m, "com xp");
    const [c] = await listComments(post.id);
    expect(c.xp).toBe(150);
    expect(c.persona).toBe("dev");
  });

  it("listPosts expõe commentCount sem N+1", async () => {
    const m = await makeMember("c6");
    const post = await createPost(m, "contando");
    await createComment(post.id, m, "um");
    await createComment(post.id, m, "dois");
    const found = (await listPosts(10)).find((p) => p.id === post.id);
    expect(found?.commentCount).toBe(2);
    // post recém-criado já sai com 0
    const fresh = await createPost(m, "zerado");
    expect(fresh.commentCount).toBe(0);
  });
});
