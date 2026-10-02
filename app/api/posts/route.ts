import { auth, currentUser } from "@clerk/nextjs/server";
import { getMemberByClerkId, getOrCreateMember } from "@/lib/members";
import { createPost, listPosts } from "@/lib/posts";
import { XP } from "@/lib/game";
import { awardXp, checkBadges } from "@/lib/xp";

export async function GET() {
  // leitura pública — rede social é vitrine; postar exige conta
  const { userId } = await auth();
  const me = userId ? getMemberByClerkId(userId) : null;
  return Response.json({ posts: listPosts(50, me?.id ?? null) });
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const user = await currentUser();
  const member = getOrCreateMember({
    id: userId,
    firstName: user?.firstName ?? null,
    lastName: user?.lastName ?? null,
    email: user?.primaryEmailAddress?.emailAddress ?? "",
    imageUrl: user?.imageUrl ?? null,
  });
  const body = await req.json().catch(() => null);
  if (typeof body?.body !== "string" || !body.body.trim()) {
    return Response.json({ error: "Post vazio" }, { status: 400 });
  }
  let post;
  try {
    post = createPost(member.id, body.body, body.link);
  } catch {
    return Response.json({ error: "Link inválido" }, { status: 400 });
  }
  awardXp(member.id, XP.post);
  checkBadges(member.id);
  return Response.json({ post }, { status: 201 });
}
