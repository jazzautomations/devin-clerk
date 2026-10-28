import { auth } from "@clerk/nextjs/server";
import { getMemberByClerkId } from "@/lib/members";
import { deletePost, getPost, updatePost } from "@/lib/posts";
import { parseId } from "@/lib/ids";
import { limitOrNull } from "@/lib/ratelimit";
import db from "@/lib/db";

// Um post (migration 034): GET lê, PATCH edita (só o autor), DELETE apaga
// (canModeratePost: autor, admin, quem modera a comunidade ou a edição).

type Ctx = { params: Promise<{ id: string }> };

const json = (error: string, status: number) => Response.json({ error }, { status });

async function me() {
  const { userId } = await auth();
  return userId ? await getMemberByClerkId(userId) : null;
}

export async function GET(_req: Request, { params }: Ctx) {
  const member = await me();
  if (!member) return json("Unauthorized", 401);
  const postId = parseId((await params).id);
  const post = postId === null ? null : await getPost(postId, member.id);
  if (!post) return json("Not found", 404);
  return Response.json({ post });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const member = await me();
  if (!member) return json("Unauthorized", 401);
  const postId = parseId((await params).id);
  // post que não existe pra mim (bloqueio, comunidade escondida) é 404
  if (postId === null || !(await getPost(postId, member.id))) return json("Not found", 404);
  const limited = limitOrNull(req, "post-edit", member.id);
  if (limited) return limited;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return json("Post vazio", 400);
  let res;
  try {
    res = await updatePost(postId, member, body.body, body.link);
  } catch (e) {
    return json(e instanceof Error ? e.message : "Post inválido", 400);
  }
  if (res === null) return json("Not found", 404);
  if (res === "forbidden") return json("Só quem escreveu edita o post.", 403);
  return Response.json({ post: res });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const member = await me();
  if (!member) return json("Unauthorized", 401);
  const postId = parseId((await params).id);
  if (postId === null) return json("Not found", 404);
  const exists = await db.prepare("SELECT 1 FROM posts WHERE id = ?").get(postId);
  if (!exists) return json("Not found", 404);
  if (!(await deletePost(postId, member))) return json("Forbidden", 403);
  return Response.json({ ok: true });
}
