import { auth } from "@clerk/nextjs/server";
import { getMemberByClerkId } from "@/lib/members";
import { toggleLike } from "@/lib/posts";
import { XP } from "@/lib/game";
import { awardXp, checkBadges } from "@/lib/xp";
import { notify } from "@/lib/notifications";
import { limitOrNull } from "@/lib/ratelimit";
import db from "@/lib/db";

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
  if (!Number.isInteger(postId) || !db.prepare("SELECT 1 FROM posts WHERE id = ?").get(postId)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const member = getMemberByClerkId(userId);
  if (!member) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  // spec 031 — like é toggle; 60/h por membro freia script de spam
  const limited = limitOrNull(req, "likes", member.id);
  if (limited) {
    return limited;
  }
  const liked = toggleLike(postId, member.id);
  if (liked) {
    const author = db
      .prepare("SELECT memberId FROM posts WHERE id = ?")
      .get(postId) as { memberId: number };
    awardXp(author.memberId, XP.likeReceived);
    checkBadges(author.memberId);
    notify(author.memberId, {
      type: "like",
      actorUsername: member.username,
      text: `@${member.username} curtiu teu post`,
      href: "/feed",
    });
  }
  const likeCount = (
    db.prepare("SELECT COUNT(*) n FROM likes WHERE postId = ?").get(postId) as {
      n: number;
    }
  ).n;
  return Response.json({ liked, likeCount });
}
