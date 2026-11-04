import { auth } from "@clerk/nextjs/server";
import { getMemberByClerkId } from "@/lib/members";
import { notifyOnce } from "@/lib/notifications";
import { parseId } from "@/lib/ids";
import { repostPost, shareTarget, unrepostPost } from "@/lib/posts";
import { limitOrNull } from "@/lib/ratelimit";

// Repost (spec 046, onda 4, migration 049). POST compartilha, DELETE tira o
// compartilhamento: o botão do card é toggle, um repost por pessoa por post.
// - 401 deslogado, 404 pra post que não existe pra mim (bloqueio nos dois
//   sentidos, igual ao resto do post), 400 pra espaço fora do ar, recado e
//   pro próprio post;
// - repostar um repost reposta o original (o repost não tem conteúdo próprio);
// - 30/h por membro ("reposts"): compartilhar em série é script, não gente;
// - o autor do original recebe 1 aviso por par ator→post (notifyOnce), e
//   repost não dá XP (plano 046, naoFazer).

type Ctx = { params: Promise<{ id: string }> };

const json = (error: string, status: number) => Response.json({ error }, { status });

async function me() {
  const { userId } = await auth();
  return userId ? await getMemberByClerkId(userId) : null;
}

export async function POST(req: Request, { params }: Ctx) {
  const member = await me();
  if (!member) return json("Unauthorized", 401);
  const postId = parseId((await params).id);
  if (postId === null) return json("Not found", 404);
  const target = await shareTarget(postId, member.id);
  if (!target.ok) return json(target.error, target.status);
  if (target.post.memberId === member.id) return json("Você não pode repostar o próprio post", 400);
  const limited = limitOrNull(req, "reposts", member.id);
  if (limited) return limited;

  const res = await repostPost(target.post, member);
  if (res.created) {
    await notifyOnce(target.post.memberId, {
      type: "repost",
      actorId: member.id,
      actorUsername: member.username,
      text: `@${member.username} compartilhou seu post`,
      href: `/post/${target.post.id}`,
    });
  }
  return Response.json(
    { post: res.post, reposted: true, created: res.created, shareCount: res.shareCount },
    { status: res.created ? 201 : 200 },
  );
}

export async function DELETE(req: Request, { params }: Ctx) {
  const member = await me();
  if (!member) return json("Unauthorized", 401);
  const postId = parseId((await params).id);
  if (postId === null) return json("Not found", 404);
  // o original, não o repost: quem chega pelo repost de outra pessoa tira o seu
  const target = await shareTarget(postId, member.id);
  if (!target.ok) return json(target.error, target.status);
  const limited = limitOrNull(req, "reposts", member.id);
  if (limited) return limited;

  const res = await unrepostPost(target.post.id, member.id);
  return Response.json({ reposted: false, removed: res.removed, shareCount: res.shareCount });
}
