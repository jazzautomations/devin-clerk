import { auth } from "@clerk/nextjs/server";
import { getMemberByClerkId } from "@/lib/members";
import { toggleLike } from "@/lib/posts";
import { XP } from "@/lib/game";
import { awardXp, checkBadges } from "@/lib/xp";
import db from "@/lib/db";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const postId = Number(id);
  if (!Number.isInteger(postId) || !db.prepare("SELECT 1 FROM posts WHERE id = ?").get(postId)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const member = getMemberByClerkId(userId);
  if (!member) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const liked = toggleLike(postId, member.id);
  if (liked) {
    const author = db
      .prepare("SELECT memberId FROM posts WHERE id = ?")
      .get(postId) as { memberId: number };
    awardXp(author.memberId, XP.likeReceived);
    checkBadges(author.memberId);
  }
  const likeCount = (
    db.prepare("SELECT COUNT(*) n FROM likes WHERE postId = ?").get(postId) as {
      n: number;
    }
  ).n;
  return Response.json({ liked, likeCount });
}
