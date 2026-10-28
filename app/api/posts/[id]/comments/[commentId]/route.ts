import { auth } from "@clerk/nextjs/server";
import { getMemberByClerkId } from "@/lib/members";
import { getComment, updateComment } from "@/lib/comments";
import { deleteComment } from "@/lib/posts";
import { parseId } from "@/lib/ids";
import { limitOrNull } from "@/lib/ratelimit";

// Um comentário (migration 034): PATCH edita (só o autor), DELETE apaga
// (autor ou quem modera o post, canModeratePost). Respostas saem junto.

type Ctx = { params: Promise<{ id: string; commentId: string }> };

const json = (error: string, status: number) => Response.json({ error }, { status });

/** o comentário tem que ser DESTE post: id alheio na URL é 404, não 403 */
async function load(params: Ctx["params"]) {
  const { id, commentId } = await params;
  const postId = parseId(id);
  const cid = parseId(commentId);
  if (postId === null || cid === null) return null;
  const comment = await getComment(cid);
  return comment && comment.postId === postId ? comment : null;
}

async function me() {
  const { userId } = await auth();
  return userId ? await getMemberByClerkId(userId) : null;
}

export async function PATCH(req: Request, { params }: Ctx) {
  const member = await me();
  if (!member) return json("Unauthorized", 401);
  const comment = await load(params);
  if (!comment) return json("Not found", 404);
  const limited = limitOrNull(req, "post-edit", member.id);
  if (limited) return limited;
  const body = await req.json().catch(() => null);
  if (typeof body?.body !== "string") return json("Comentário inválido", 400);
  let res;
  try {
    res = await updateComment(comment.id, member.id, body.body);
  } catch (e) {
    return json(e instanceof Error ? e.message : "Comentário inválido", 400);
  }
  if (res === null) return json("Not found", 404);
  if (res === "forbidden") return json("Só quem escreveu edita o comentário.", 403);
  return Response.json({ comment: res });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const member = await me();
  if (!member) return json("Unauthorized", 401);
  const comment = await load(params);
  if (!comment) return json("Not found", 404);
  if (!(await deleteComment(comment.id, member))) return json("Forbidden", 403);
  return Response.json({ ok: true });
}
