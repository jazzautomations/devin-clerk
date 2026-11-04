import db from "@/lib/db";
import { hiddenAuthorSql } from "@/lib/blocks";
import { textArray } from "@/lib/posts";
import { syncMentionsAndTags } from "@/lib/tags";

// Comentários de post (migration 034): respostas em 1 nível. Comentário de
// topo tem parentId nulo; resposta aponta pra um comentário de topo do mesmo
// post. listComments devolve os de topo com replies[] em ordem de conversa.
//
// Menção @ (migration 039): o comentário também notifica quem é mencionado e
// devolve mentionedUsernames (só os @ que existem) pra virar link. Tag de
// comentário não entra no índice de tags: a página é do post.
export type Comment = {
  id: number;
  postId: number;
  memberId: number;
  parentId: number | null;
  body: string;
  createdAt: string;
  editedAt: string | null;
  username: string;
  name: string | null;
  avatarUrl: string | null;
  persona: string | null;
  xp: number;
  /** @ que existem de verdade no corpo do comentário — viram link */
  mentionedUsernames: string[];
  /** só nos de topo; resposta não tem resposta */
  replies?: Comment[];
};

export const COMMENT_MAX = 1000;

const select = `SELECT c.id, c.postId, c.memberId, c.parentId, c.body, c.createdAt, c.editedAt,
       m.username, m.name, m.avatarUrl, m.persona, m.xp,
       COALESCE((SELECT array_agg(mt.username ORDER BY mt.username)
         FROM post_mentions pm JOIN members mt ON mt.id = pm.memberId
         WHERE pm.commentId = c.id AND ${hiddenAuthorSql("mt.id")}), '{}') AS "mentionedUsernames"
       FROM post_comments c JOIN members m ON m.id = c.memberId`;

type CommentRow = Omit<Comment, "mentionedUsernames" | "replies"> & {
  mentionedUsernames: string[] | string | null;
};

const norm = (c: CommentRow): Comment => ({
  ...c,
  id: Number(c.id),
  postId: Number(c.postId),
  memberId: Number(c.memberId),
  parentId: c.parentId === null ? null : Number(c.parentId),
  mentionedUsernames: textArray(c.mentionedUsernames),
});

/**
 * Conversa na ordem (ASC, desempate por id). Sem autores de hiddenIdsFor(meId):
 * comentário de topo escondido leva junto as respostas dele.
 */
export async function listComments(postId: number, meId: number | null = null): Promise<Comment[]> {
  const rows = (
    await db
      .prepare(`${select} WHERE c.postId = @post AND ${hiddenAuthorSql("c.memberId")} ORDER BY c.createdAt ASC, c.id ASC`)
      .all<CommentRow>({ post: postId, me: meId ?? -1 })
  ).map(norm);
  const top: Comment[] = [];
  const byId = new Map<number, Comment>();
  for (const c of rows) {
    if (c.parentId === null) {
      const t = { ...c, replies: [] };
      top.push(t);
      byId.set(c.id, t);
    }
  }
  for (const c of rows) {
    if (c.parentId !== null) byId.get(c.parentId)?.replies!.push(c);
  }
  return top;
}

/** um comentário, ou null. meId só filtra as menções que quem lê ainda vê. */
export async function getComment(id: number, meId: number | null = null): Promise<Comment | null> {
  const row = await db.prepare(`${select} WHERE c.id = @id`).get<CommentRow>({ id, me: meId ?? -1 });
  return row ? norm(row) : null;
}

function validBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed) throw new Error("Comentário vazio");
  if (trimmed.length > COMMENT_MAX) throw new Error("Comentário longo demais");
  return trimmed;
}

/**
 * Cria comentário ou resposta. parentId tem que ser comentário de topo do
 * mesmo post, senão Error("Resposta inválida").
 */
export async function createComment(
  postId: number,
  memberId: number,
  body: string,
  parentId: number | null = null,
): Promise<Comment> {
  const trimmed = validBody(body);
  if (parentId !== null) {
    const parent = await db
      .prepare("SELECT postId, parentId FROM post_comments WHERE id = ?")
      .get<{ postId: number; parentId: number | null }>(parentId);
    if (!parent || Number(parent.postId) !== postId || parent.parentId !== null) throw new Error("Resposta inválida");
  }
  const row = await db
    .prepare("INSERT INTO post_comments (postId, memberId, body, parentId) VALUES (?, ?, ?, ?) RETURNING id")
    .get<{ id: number }>(postId, memberId, trimmed, parentId);
  const created = (await getComment(row!.id))!;
  // menção do comentário: grava e avisa quem é mencionado pela primeira vez
  await syncMentionsAndTags(postId, created.id, trimmed, { id: memberId, username: created.username });
  const c = (await getComment(created.id))!;
  return parentId === null ? { ...c, replies: [] } : c;
}

/** só o autor edita. null = não existe; "forbidden" = não é dele */
export async function updateComment(
  commentId: number,
  memberId: number,
  body: string,
): Promise<Comment | null | "forbidden"> {
  const cur = await getComment(commentId);
  if (!cur) return null;
  if (cur.memberId !== memberId) return "forbidden";
  const trimmed = validBody(body);
  await db.prepare(`UPDATE post_comments SET body = ?, "editedAt" = datetime('now') WHERE id = ?`).run(trimmed, commentId);
  // editar reescreve as menções do comentário; ninguém é avisado de novo
  await syncMentionsAndTags(cur.postId, commentId, trimmed, { id: memberId, username: cur.username });
  return getComment(commentId);
}
