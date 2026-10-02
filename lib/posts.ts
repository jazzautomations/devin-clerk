import db from "@/lib/db";

export type Post = {
  id: number;
  body: string;
  link: string | null;
  createdAt: string;
  username: string;
  name: string | null;
  headline: string | null;
  persona: string | null;
  xp: number;
  likeCount: number;
  likedByMe: boolean;
  commentCount: number;
};

const select = `SELECT p.id, p.body, p.link, p.createdAt,
       m.username, m.name, m.headline, m.persona, m.xp,
       (SELECT COUNT(*) FROM likes l WHERE l.postId = p.id) AS likeCount,
       (SELECT COUNT(*) FROM post_comments c WHERE c.postId = p.id) AS commentCount,
       EXISTS(SELECT 1 FROM likes l WHERE l.postId = p.id AND l.memberId = @me) AS likedByMe
       FROM posts p JOIN members m ON m.id = p.memberId`;

export function listPosts(limit = 50, meId: number | null = null): Post[] {
  return db
    .prepare(`${select} ORDER BY p.id DESC LIMIT @limit`)
    .all({ me: meId ?? -1, limit })
    .map((p) => ({ ...(p as Post), likedByMe: Boolean((p as Post).likedByMe) }));
}

export function createPost(
  memberId: number,
  body: string,
  link?: string | null,
): Post {
  const trimmed = body.trim().slice(0, 500);
  if (!trimmed) throw new Error("Post vazio");
  const url = link?.trim() || null;
  if (url && !/^https?:\/\//i.test(url)) throw new Error("Link inválido");
  db.prepare("INSERT INTO posts (memberId, body, link) VALUES (?, ?, ?)").run(
    memberId,
    trimmed,
    url,
  );
  const post = db
    .prepare(`${select} ORDER BY p.id DESC LIMIT 1`)
    .get({ me: memberId }) as Post;
  post.likedByMe = false;
  return post;
}

export function toggleLike(postId: number, memberId: number): boolean {
  const existing = db
    .prepare("SELECT 1 FROM likes WHERE postId = ? AND memberId = ?")
    .get(postId, memberId);
  if (existing) {
    db.prepare("DELETE FROM likes WHERE postId = ? AND memberId = ?").run(
      postId,
      memberId,
    );
    return false;
  }
  db.prepare("INSERT INTO likes (postId, memberId) VALUES (?, ?)").run(
    postId,
    memberId,
  );
  return true;
}
