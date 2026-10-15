import db from "@/lib/db";
import type { Member } from "@/lib/members";

// avatarUrl é coluna de lib/members — garante o ALTER aqui pra quem importa
// este módulo sem passar por members.ts (ex.: testes unitários)
// hackathonId = mural da edição (spec 028): NULL é post global do /feed —
// ALTER guardado aqui mesmo, lib/db.ts continua intocado
export type Post = {
  id: number;
  body: string;
  link: string | null;
  createdAt: string;
  hackathonId: string | null;
  hackathonName: string | null;
  // mural da comunidade (migration 027)
  communityId: number | null;
  communityName: string | null;
  communitySlug: string | null;
  username: string;
  name: string | null;
  avatarUrl: string | null;
  headline: string | null;
  persona: string | null;
  xp: number;
  likeCount: number;
  likedByMe: boolean;
  commentCount: number;
};

const select = `SELECT p.id, p.body, p.link, p.createdAt, p.hackathonId,
       h.name AS hackathonName, p.communityId, co.name AS "communityName", co.slug AS "communitySlug",
       m.username, m.name, m.avatarUrl, m.headline, m.persona, m.xp,
       (SELECT COUNT(*) FROM likes l WHERE l.postId = p.id) AS likeCount,
       (SELECT COUNT(*) FROM post_comments c WHERE c.postId = p.id) AS commentCount,
       EXISTS(SELECT 1 FROM likes l WHERE l.postId = p.id AND l.memberId = @me) AS likedByMe
       FROM posts p JOIN members m ON m.id = p.memberId
       LEFT JOIN hackathons h ON h.id = p.hackathonId
       LEFT JOIN communities co ON co.id = p.communityId`;

// spec 028 — escopo do mural: omitido agrega tudo (/feed mostra global +
// edições e comunidades com chip, sem as comunidades escondidas);
// {hackathonId} isola a edição; {communityId} o mural da comunidade;
// {global} só posts sem edição nem comunidade
export type PostScope = { hackathonId: string } | { communityId: number } | { global: true };

export async function listPosts(
  limit = 50,
  meId: number | null = null,
  scope?: PostScope,
): Promise<Post[]> {
  const where = !scope
    ? "WHERE COALESCE(co.hidden, 0) = 0"
    : "hackathonId" in scope
      ? "WHERE p.hackathonId = @h"
      : "communityId" in scope
        ? "WHERE p.communityId = @c"
        : "WHERE p.hackathonId IS NULL AND p.communityId IS NULL";
  const params: Record<string, unknown> = { me: meId ?? -1, limit };
  if (scope && "hackathonId" in scope) params.h = scope.hackathonId;
  if (scope && "communityId" in scope) params.c = scope.communityId;
  return (await db
    .prepare(`${select} ${where} ORDER BY p.id DESC LIMIT @limit`)
    .all(params))
    .map((p) => ({ ...(p as Post), likedByMe: Boolean((p as Post).likedByMe) }));
}

export async function createPost(
  memberId: number,
  body: string,
  link?: string | null,
  hackathonId?: string | null,
  communityId?: number | null,
): Promise<Post> {
  const trimmed = body.trim().slice(0, 500);
  if (!trimmed) throw new Error("Post vazio");
  const url = link?.trim() || null;
  if (url && !/^https?:\/\//i.test(url)) throw new Error("Link inválido");
  // escopo é só persistido aqui — edição existe/ativa e inscrição do membro
  // são validados na rota, que tem os códigos HTTP (404/400/403)
  const row = await db.prepare(
    "INSERT INTO posts (memberId, body, link, hackathonId, communityId) VALUES (?, ?, ?, ?, ?) RETURNING id",
  ).get<{ id: number }>(memberId, trimmed, url, hackathonId?.trim() || null, communityId ?? null);
  const post = await db
    .prepare(`${select} WHERE p.id = @id`)
    .get({ me: memberId, id: row!.id }) as Post;
  post.likedByMe = false;
  return post;
}

// moderação: autor apaga o seu, admin apaga qualquer um — a cascata é
// transacional pra nunca deixar like/comentário órfão de post que não existe
export async function deletePost(postId: number, requester: Member): Promise<boolean> {
  const post = await db
    .prepare("SELECT memberId FROM posts WHERE id = ?")
    .get(postId) as { memberId: number } | undefined;
  if (!post) return false;
  if (requester.role !== "admin" && post.memberId !== requester.id) {
    return false;
  }
  await db.transaction(async () => {
    await db.prepare("DELETE FROM likes WHERE postId = ?").run(postId);
    await db.prepare("DELETE FROM post_comments WHERE postId = ?").run(postId);
    await db.prepare("DELETE FROM posts WHERE id = ?").run(postId);
  })();
  return true;
}

export async function deleteComment(commentId: number, requester: Member): Promise<boolean> {
  const comment = await db
    .prepare("SELECT memberId FROM post_comments WHERE id = ?")
    .get(commentId) as { memberId: number } | undefined;
  if (!comment) return false;
  if (requester.role !== "admin" && comment.memberId !== requester.id) {
    return false;
  }
  await db.prepare("DELETE FROM post_comments WHERE id = ?").run(commentId);
  return true;
}

export async function toggleLike(postId: number, memberId: number): Promise<boolean> {
  const existing = await db
    .prepare("SELECT 1 FROM likes WHERE postId = ? AND memberId = ?")
    .get(postId, memberId);
  if (existing) {
    await db.prepare("DELETE FROM likes WHERE postId = ? AND memberId = ?").run(
      postId,
      memberId,
    );
    return false;
  }
  await db.prepare("INSERT INTO likes (postId, memberId) VALUES (?, ?)").run(
    postId,
    memberId,
  );
  return true;
}
