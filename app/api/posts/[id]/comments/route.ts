import { auth } from "@clerk/nextjs/server";
import { getMemberByClerkId } from "@/lib/members";
import { createComment, listComments } from "@/lib/comments";
import { XP } from "@/lib/game";
import { awardXp, checkBadges } from "@/lib/xp";
import db from "@/lib/db";

function postExists(postId: number): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM posts WHERE id = ?").get(postId),
  );
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // leitura pública — a conversa é vitrine; comentar exige conta
  const { id } = await params;
  const postId = Number(id);
  if (!Number.isInteger(postId) || !postExists(postId)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json({ comments: listComments(postId) });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const postId = Number(id);
  if (!Number.isInteger(postId) || !postExists(postId)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const member = getMemberByClerkId(userId);
  if (!member) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  const text = typeof body?.body === "string" ? body.body.trim() : "";
  if (!text || text.length > 1000) {
    return Response.json({ error: "Comentário inválido" }, { status: 400 });
  }
  const comment = createComment(postId, member.id, text);
  awardXp(member.id, XP.comment);
  checkBadges(member.id);
  return Response.json({ comment }, { status: 201 });
}
