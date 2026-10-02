import { auth } from "@clerk/nextjs/server";
import { getMemberByClerkId } from "@/lib/members";
import { deleteComment } from "@/lib/posts";
import db from "@/lib/db";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; commentId: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const member = getMemberByClerkId(userId);
  if (!member) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id, commentId } = await params;
  const postId = Number(id);
  const cid = Number(commentId);
  if (!Number.isInteger(postId) || !Number.isInteger(cid)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  // o comentário tem que ser DESTE post — id alheio na URL é 404, não 403
  const comment = db
    .prepare("SELECT postId FROM post_comments WHERE id = ?")
    .get(cid) as { postId: number } | undefined;
  if (!comment || comment.postId !== postId) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (!deleteComment(cid, member)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return Response.json({ ok: true });
}
