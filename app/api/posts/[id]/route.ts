import { auth } from "@clerk/nextjs/server";
import { getMemberByClerkId } from "@/lib/members";
import { deletePost } from "@/lib/posts";
import db from "@/lib/db";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const member = getMemberByClerkId(userId);
  if (!member) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const postId = Number(id);
  if (!Number.isInteger(postId)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const post = db
    .prepare("SELECT 1 FROM posts WHERE id = ?")
    .get(postId);
  if (!post) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (!deletePost(postId, member)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return Response.json({ ok: true });
}
