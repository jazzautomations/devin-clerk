import { describe, expect, it } from "vitest";
import db from "@/lib/db";
import { createComment, listComments } from "@/lib/comments";
import { getMemberByClerkId, type Member } from "@/lib/members";
import {
  createPost,
  deleteComment,
  deletePost,
  listPosts,
  toggleLike,
} from "@/lib/posts";

async function makeMember(
  clerkId: string,
  role: "member" | "admin" = "member",
): Promise<Member> {
  await db.prepare(
    "INSERT INTO members (clerkId, username, email) VALUES (?, ?, ?)",
  ).run(clerkId, `u_${clerkId}`, `${clerkId}@t.dev`);
  if (role === "admin") {
    await db.prepare("UPDATE members SET role = 'admin' WHERE clerkId = ?").run(
      clerkId,
    );
  }
  return (await getMemberByClerkId(clerkId))!;
}

const count = async (sql: string, ...args: number[]) =>
  (await db.prepare(sql).get(...args) as { n: number }).n;

describe("deletePost — autor ou admin", () => {
  it("autor apaga o próprio post", async () => {
    const m = await makeMember("mod_p1");
    const post = await createPost(m.id, "meu post");
    expect(await deletePost(post.id, m)).toBe(true);
    expect((await listPosts(50)).find((p) => p.id === post.id)).toBeUndefined();
    expect(await count("SELECT COUNT(*) n FROM posts WHERE id = ?", post.id)).toBe(0);
  });

  it("admin apaga post de terceiro", async () => {
    const author = await makeMember("mod_p2");
    const admin = await makeMember("mod_admin1", "admin");
    const post = await createPost(author.id, "post alheio");
    expect(await deletePost(post.id, admin)).toBe(true);
    expect(await count("SELECT COUNT(*) n FROM posts WHERE id = ?", post.id)).toBe(0);
  });

  it("stranger não apaga post alheio — false e nada muda", async () => {
    const author = await makeMember("mod_p3");
    const stranger = await makeMember("mod_p4");
    const post = await createPost(author.id, "intocado");
    expect(await deletePost(post.id, stranger)).toBe(false);
    expect(await count("SELECT COUNT(*) n FROM posts WHERE id = ?", post.id)).toBe(1);
  });

  it("post inexistente → false (sem erro)", async () => {
    const m = await makeMember("mod_p5");
    const admin = await makeMember("mod_admin2", "admin");
    expect(await deletePost(999999, m)).toBe(false);
    expect(await deletePost(999999, admin)).toBe(false);
  });

  it("cascata: apagar post zera likes e comentários dele", async () => {
    const author = await makeMember("mod_p6");
    const liker = await makeMember("mod_p7");
    const commenter = await makeMember("mod_p8");
    const post = await createPost(author.id, "com engajamento");
    await toggleLike(post.id, liker.id);
    await toggleLike(post.id, commenter.id);
    await createComment(post.id, commenter.id, "primeiro!");
    await createComment(post.id, author.id, "valeu");
    expect(await count("SELECT COUNT(*) n FROM likes WHERE postId = ?", post.id)).toBe(2);
    expect(
      await count("SELECT COUNT(*) n FROM post_comments WHERE postId = ?", post.id),
    ).toBe(2);

    expect(await deletePost(post.id, author)).toBe(true);
    expect(await count("SELECT COUNT(*) n FROM posts WHERE id = ?", post.id)).toBe(0);
    expect(await count("SELECT COUNT(*) n FROM likes WHERE postId = ?", post.id)).toBe(0);
    expect(
      await count("SELECT COUNT(*) n FROM post_comments WHERE postId = ?", post.id),
    ).toBe(0);
  });

  it("cascata não toca em likes/comentários de outro post", async () => {
    const author = await makeMember("mod_p9");
    const admin = await makeMember("mod_admin3", "admin");
    const p1 = await createPost(author.id, "vai morrer");
    const p2 = await createPost(author.id, "fica vivo");
    await toggleLike(p1.id, admin.id);
    await toggleLike(p2.id, admin.id);
    await createComment(p1.id, admin.id, "adeus");
    await createComment(p2.id, admin.id, "fico");

    await deletePost(p1.id, admin);
    expect(await count("SELECT COUNT(*) n FROM likes WHERE postId = ?", p2.id)).toBe(1);
    expect(await listComments(p2.id)).toHaveLength(1);
  });
});

describe("deleteComment — autor ou admin", () => {
  it("autor apaga o próprio comentário", async () => {
    const m = await makeMember("mod_c1");
    const post = await createPost(m.id, "post");
    const c = await createComment(post.id, m.id, "errei");
    expect(await deleteComment(c.id, m)).toBe(true);
    expect(await listComments(post.id)).toHaveLength(0);
  });

  it("admin apaga comentário de terceiro", async () => {
    const author = await makeMember("mod_c2");
    const admin = await makeMember("mod_admin4", "admin");
    const post = await createPost(author.id, "post");
    const c = await createComment(post.id, author.id, "alvo da moderação");
    expect(await deleteComment(c.id, admin)).toBe(true);
    expect(
      await count("SELECT COUNT(*) n FROM post_comments WHERE id = ?", c.id),
    ).toBe(0);
  });

  it("stranger não apaga comentário alheio — false e nada muda", async () => {
    const author = await makeMember("mod_c3");
    const stranger = await makeMember("mod_c4");
    const post = await createPost(author.id, "post");
    const c = await createComment(post.id, author.id, "meu");
    expect(await deleteComment(c.id, stranger)).toBe(false);
    expect(
      await count("SELECT COUNT(*) n FROM post_comments WHERE id = ?", c.id),
    ).toBe(1);
  });

  it("dono do post modera a conversa dele (canModeratePost, migration 034)", async () => {
    const owner = await makeMember("mod_c5");
    const commenter = await makeMember("mod_c6");
    const post = await createPost(owner.id, "post do owner");
    const c = await createComment(post.id, commenter.id, "comentário de terceiro");
    expect(await deleteComment(c.id, owner)).toBe(true);
    expect(await listComments(post.id)).toHaveLength(0);
  });

  it("comentário inexistente → false", async () => {
    const admin = await makeMember("mod_admin5", "admin");
    expect(await deleteComment(999999, admin)).toBe(false);
  });
});
