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

function makeMember(
  clerkId: string,
  role: "member" | "admin" = "member",
): Member {
  db.prepare(
    "INSERT INTO members (clerkId, username, email) VALUES (?, ?, ?)",
  ).run(clerkId, `u_${clerkId}`, `${clerkId}@t.dev`);
  if (role === "admin") {
    db.prepare("UPDATE members SET role = 'admin' WHERE clerkId = ?").run(
      clerkId,
    );
  }
  return getMemberByClerkId(clerkId)!;
}

const count = (sql: string, ...args: number[]) =>
  (db.prepare(sql).get(...args) as { n: number }).n;

describe("deletePost — autor ou admin", () => {
  it("autor apaga o próprio post", () => {
    const m = makeMember("mod_p1");
    const post = createPost(m.id, "meu post");
    expect(deletePost(post.id, m)).toBe(true);
    expect(listPosts(50).find((p) => p.id === post.id)).toBeUndefined();
    expect(count("SELECT COUNT(*) n FROM posts WHERE id = ?", post.id)).toBe(0);
  });

  it("admin apaga post de terceiro", () => {
    const author = makeMember("mod_p2");
    const admin = makeMember("mod_admin1", "admin");
    const post = createPost(author.id, "post alheio");
    expect(deletePost(post.id, admin)).toBe(true);
    expect(count("SELECT COUNT(*) n FROM posts WHERE id = ?", post.id)).toBe(0);
  });

  it("stranger não apaga post alheio — false e nada muda", () => {
    const author = makeMember("mod_p3");
    const stranger = makeMember("mod_p4");
    const post = createPost(author.id, "intocado");
    expect(deletePost(post.id, stranger)).toBe(false);
    expect(count("SELECT COUNT(*) n FROM posts WHERE id = ?", post.id)).toBe(1);
  });

  it("post inexistente → false (sem erro)", () => {
    const m = makeMember("mod_p5");
    const admin = makeMember("mod_admin2", "admin");
    expect(deletePost(999999, m)).toBe(false);
    expect(deletePost(999999, admin)).toBe(false);
  });

  it("cascata: apagar post zera likes e comentários dele", () => {
    const author = makeMember("mod_p6");
    const liker = makeMember("mod_p7");
    const commenter = makeMember("mod_p8");
    const post = createPost(author.id, "com engajamento");
    toggleLike(post.id, liker.id);
    toggleLike(post.id, commenter.id);
    createComment(post.id, commenter.id, "primeiro!");
    createComment(post.id, author.id, "valeu");
    expect(count("SELECT COUNT(*) n FROM likes WHERE postId = ?", post.id)).toBe(2);
    expect(
      count("SELECT COUNT(*) n FROM post_comments WHERE postId = ?", post.id),
    ).toBe(2);

    expect(deletePost(post.id, author)).toBe(true);
    expect(count("SELECT COUNT(*) n FROM posts WHERE id = ?", post.id)).toBe(0);
    expect(count("SELECT COUNT(*) n FROM likes WHERE postId = ?", post.id)).toBe(0);
    expect(
      count("SELECT COUNT(*) n FROM post_comments WHERE postId = ?", post.id),
    ).toBe(0);
  });

  it("cascata não toca em likes/comentários de outro post", () => {
    const author = makeMember("mod_p9");
    const admin = makeMember("mod_admin3", "admin");
    const p1 = createPost(author.id, "vai morrer");
    const p2 = createPost(author.id, "fica vivo");
    toggleLike(p1.id, admin.id);
    toggleLike(p2.id, admin.id);
    createComment(p1.id, admin.id, "adeus");
    createComment(p2.id, admin.id, "fico");

    deletePost(p1.id, admin);
    expect(count("SELECT COUNT(*) n FROM likes WHERE postId = ?", p2.id)).toBe(1);
    expect(listComments(p2.id)).toHaveLength(1);
  });
});

describe("deleteComment — autor ou admin", () => {
  it("autor apaga o próprio comentário", () => {
    const m = makeMember("mod_c1");
    const post = createPost(m.id, "post");
    const c = createComment(post.id, m.id, "errei");
    expect(deleteComment(c.id, m)).toBe(true);
    expect(listComments(post.id)).toHaveLength(0);
  });

  it("admin apaga comentário de terceiro", () => {
    const author = makeMember("mod_c2");
    const admin = makeMember("mod_admin4", "admin");
    const post = createPost(author.id, "post");
    const c = createComment(post.id, author.id, "alvo da moderação");
    expect(deleteComment(c.id, admin)).toBe(true);
    expect(
      count("SELECT COUNT(*) n FROM post_comments WHERE id = ?", c.id),
    ).toBe(0);
  });

  it("stranger não apaga comentário alheio — false e nada muda", () => {
    const author = makeMember("mod_c3");
    const stranger = makeMember("mod_c4");
    const post = createPost(author.id, "post");
    const c = createComment(post.id, author.id, "meu");
    expect(deleteComment(c.id, stranger)).toBe(false);
    expect(
      count("SELECT COUNT(*) n FROM post_comments WHERE id = ?", c.id),
    ).toBe(1);
  });

  it("dono do post NÃO apaga comentário alheio — só autor ou admin", () => {
    const owner = makeMember("mod_c5");
    const commenter = makeMember("mod_c6");
    const post = createPost(owner.id, "post do owner");
    const c = createComment(post.id, commenter.id, "comentário de terceiro");
    expect(deleteComment(c.id, owner)).toBe(false);
    expect(listComments(post.id)).toHaveLength(1);
  });

  it("comentário inexistente → false", () => {
    const admin = makeMember("mod_admin5", "admin");
    expect(deleteComment(999999, admin)).toBe(false);
  });
});
