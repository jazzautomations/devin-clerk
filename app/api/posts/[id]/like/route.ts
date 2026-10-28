import { auth } from "@clerk/nextjs/server";
import { getMemberByClerkId } from "@/lib/members";
import { getPost, isReactionKind, reactionCounts, REACTION_KINDS, REACTION_LABEL, setReaction, type ReactionKind } from "@/lib/posts";
import { notifyOnce } from "@/lib/notifications";
import { parseId } from "@/lib/ids";
import { limitOrNull } from "@/lib/ratelimit";

// Reação (migration 034). POST {kind?: 'curti'|'ajudou'|'quero_testar'|'aprendi'|null}:
// sem kind é 'curti', null tira. Uma reação por pessoa por post; trocar de
// tipo substitui. Reação não dá XP. O autor recebe uma notificação por
// pessoa, pra sempre: tirar e reagir de novo não avisa de novo.

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const member = await getMemberByClerkId(userId);
  if (!member) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const postId = parseId((await params).id);
  // post de quem me bloqueou (ou que eu bloqueei) não existe pra mim
  const post = postId === null ? null : await getPost(postId, member.id);
  if (!post) return Response.json({ error: "Not found" }, { status: 404 });
  if (post.memberId === member.id) {
    return Response.json({ error: "Você não pode reagir ao próprio post" }, { status: 400 });
  }
  const limited = limitOrNull(req, "likes", member.id);
  if (limited) return limited;

  const body = await req.json().catch(() => ({}));
  const raw: unknown = body && typeof body === "object" && "kind" in body ? (body as { kind: unknown }).kind : "curti";
  if (raw !== null && !isReactionKind(raw)) {
    return Response.json({ error: `Reação inválida. Use ${REACTION_KINDS.join(", ")}.` }, { status: 400 });
  }
  const kind = raw as ReactionKind | null;
  const res = await setReaction(post.id, member.id, kind);

  if (res.changed && kind) {
    // 1 por par pra sempre, mesmo com duas reações ao mesmo tempo
    await notifyOnce(post.memberId, {
      type: "reaction",
      actorId: member.id,
      actorUsername: member.username,
      text: `@${member.username} reagiu ao seu post: ${REACTION_LABEL[kind]}`,
      href: `/post/${post.id}`,
    });
  }
  const reactions = await reactionCounts(post.id);
  const likeCount = REACTION_KINDS.reduce((s, k) => s + reactions[k], 0);
  return Response.json({ kind: res.kind, liked: res.kind !== null, reactions, likeCount });
}
