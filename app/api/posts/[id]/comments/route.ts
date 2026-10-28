import { auth } from "@clerk/nextjs/server";
import { getMemberByClerkId } from "@/lib/members";
import { COMMENT_MAX, createComment, getComment, listComments } from "@/lib/comments";
import { getPost } from "@/lib/posts";
import { notify } from "@/lib/notifications";
import { parseId } from "@/lib/ids";
import { limitOrNull } from "@/lib/ratelimit";

// Conversa do post (migration 034): comentários de topo com respostas em 1
// nível. Comentar não dá XP. O autor do post é avisado (link direto pro
// comentário) e, numa resposta, quem escreveu o comentário respondido também.

const KNOWN_ERRORS = new Set(["Resposta inválida", "Comentário vazio", "Comentário longo demais"]);

type Ctx = { params: Promise<{ id: string }> };

async function viewer() {
  const { userId } = await auth();
  return userId ? await getMemberByClerkId(userId) : null;
}

export async function GET(_req: Request, { params }: Ctx) {
  const member = await viewer();
  const postId = parseId((await params).id);
  if (postId === null) return Response.json({ error: "Not found" }, { status: 404 });
  // sem conta (o proxy já barra; aqui é a segunda trava) getPost só deixa
  // passar post de espaço que está no ar
  if (!(await getPost(postId, member?.id ?? null))) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json({ comments: await listComments(postId, member?.id ?? null) });
}

export async function POST(req: Request, { params }: Ctx) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const member = await getMemberByClerkId(userId);
  if (!member) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const postId = parseId((await params).id);
  const post = postId === null ? null : await getPost(postId, member.id);
  if (!post) return Response.json({ error: "Not found" }, { status: 404 });
  // spec 031 — comentar demais vira 429 (30/h por membro)
  const limited = limitOrNull(req, "comments", member.id);
  if (limited) return limited;

  const body = await req.json().catch(() => null);
  const text = typeof body?.body === "string" ? body.body.trim() : "";
  if (!text || text.length > COMMENT_MAX) {
    return Response.json({ error: "Comentário inválido" }, { status: 400 });
  }
  const rawParent: unknown = body?.parentId ?? null;
  let parentId: number | null = null;
  if (rawParent !== null) {
    // parseId limita ao INT4 do banco: id gigante é 400 nosso, não erro do pg
    parentId = typeof rawParent === "number" || typeof rawParent === "string" ? parseId(String(rawParent)) : null;
    if (parentId === null) {
      return Response.json({ error: "Resposta inválida" }, { status: 400 });
    }
  }
  let comment;
  try {
    comment = await createComment(post.id, member.id, text, parentId);
  } catch (e) {
    // só as mensagens nossas voltam pro cliente; erro do banco não vaza
    const msg = e instanceof Error && KNOWN_ERRORS.has(e.message) ? e.message : "Comentário inválido";
    return Response.json({ error: msg }, { status: 400 });
  }

  const href = `/post/${post.id}#c-${comment.id}`;
  await notify(post.memberId, {
    type: "comment",
    actorId: member.id,
    actorUsername: member.username,
    text: `@${member.username} comentou no seu post`,
    href,
  });
  if (parentId !== null) {
    const parent = await getComment(parentId);
    // quem escreveu o post já foi avisado acima
    if (parent && parent.memberId !== post.memberId) {
      await notify(parent.memberId, {
        type: "reply",
        actorId: member.id,
        actorUsername: member.username,
        text: `@${member.username} respondeu seu comentário`,
        href,
      });
    }
  }
  return Response.json({ comment }, { status: 201 });
}
