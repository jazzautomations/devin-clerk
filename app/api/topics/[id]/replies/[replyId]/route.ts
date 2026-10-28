import { requireMember } from "@/lib/communityAuth";
import { parseId } from "@/lib/ids";
import { limitOrNull } from "@/lib/ratelimit";
import { deleteReply, topicErrorResponse, updateReply } from "@/lib/topics";

// Uma resposta (migration 058). PATCH: o autor edita ({body}). DELETE: o
// autor apaga (vira "[apagado]" se tiver resposta embaixo) ou a moderação
// remove ("[removido pela moderação]"). A árvore fica.

type Ctx = { params: Promise<{ id: string; replyId: string }> };

async function ids(params: Ctx["params"]) {
  const p = await params;
  return { id: parseId(p.id), replyId: parseId(p.replyId) };
}

export async function PATCH(req: Request, { params }: Ctx) {
  const g = await requireMember();
  if ("response" in g) return g.response;
  const { id, replyId } = await ids(params);
  if (id === null || replyId === null) return Response.json({ error: "Not found" }, { status: 404 });
  const limited = limitOrNull(req, "topic-edit", g.member.id);
  if (limited) return limited;
  const body = await req.json().catch(() => null);
  try {
    return Response.json({ reply: await updateReply(id, replyId, g.member, body?.body) });
  } catch (e) {
    return topicErrorResponse(e);
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  const g = await requireMember();
  if ("response" in g) return g.response;
  const { id, replyId } = await ids(params);
  if (id === null || replyId === null) return Response.json({ error: "Not found" }, { status: 404 });
  const limited = limitOrNull(req, "topic-edit", g.member.id);
  if (limited) return limited;
  try {
    return Response.json({ result: await deleteReply(id, replyId, g.member) });
  } catch (e) {
    return topicErrorResponse(e);
  }
}
