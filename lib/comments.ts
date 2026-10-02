import db, { ensureColumn } from "@/lib/db";

// avatarUrl é coluna de lib/members — garante o ALTER aqui pra quem importa
// este módulo sem passar por members.ts
ensureColumn("members", "avatarUrl", "avatarUrl TEXT");

export type Comment = {
  id: number;
  postId: number;
  body: string;
  createdAt: string;
  username: string;
  name: string | null;
  avatarUrl: string | null;
  persona: string | null;
  xp: number;
};

const select = `SELECT c.id, c.postId, c.body, c.createdAt,
       m.username, m.name, m.avatarUrl, m.persona, m.xp
       FROM post_comments c JOIN members m ON m.id = c.memberId`;

// conversa se lê na ordem — ASC com desempate por id (mesmo segundo)
export function listComments(postId: number): Comment[] {
  return db
    .prepare(
      `${select} WHERE c.postId = ? ORDER BY c.createdAt ASC, c.id ASC`,
    )
    .all(postId) as Comment[];
}

export function createComment(
  postId: number,
  memberId: number,
  body: string,
): Comment {
  const trimmed = body.trim();
  if (!trimmed) throw new Error("Comentário vazio");
  if (trimmed.length > 1000) throw new Error("Comentário longo demais");
  db.prepare(
    "INSERT INTO post_comments (postId, memberId, body) VALUES (?, ?, ?)",
  ).run(postId, memberId, trimmed);
  return db
    .prepare(`${select} WHERE c.postId = ? ORDER BY c.id DESC LIMIT 1`)
    .get(postId) as Comment;
}
