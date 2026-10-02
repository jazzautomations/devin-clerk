import db from "@/lib/db";

export type Post = {
  id: number;
  body: string;
  link: string | null;
  createdAt: string;
  username: string;
  name: string | null;
  headline: string | null;
};

const select = `SELECT p.id, p.body, p.link, p.createdAt, m.username, m.name, m.headline
       FROM posts p JOIN members m ON m.id = p.memberId`;

export function listPosts(limit = 50): Post[] {
  return db.prepare(`${select} ORDER BY p.id DESC LIMIT ?`).all(limit) as Post[];
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
  return db
    .prepare(`${select} ORDER BY p.id DESC LIMIT 1`)
    .get() as Post;
}
