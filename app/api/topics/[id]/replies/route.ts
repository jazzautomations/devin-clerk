import { requireMember } from "@/lib/communityAuth";
import { parseId } from "@/lib/ids";
import { limitOrNull } from "@/lib/ratelimit";
import { createReply, getTopic, listReplies, parseReplySort, topicErrorResponse } from "@/lib/topics";

// Respostas do tópico (migration 058). GET devolve a árvore; POST responde o
// tópico ({body}) ou uma resposta ({body, parentId}). Membro da comunidade,
// 60/h. O autor do tópico e o da resposta respondida recebem aviso agrupado.

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const g = await requireMember();
  if ("response" in g) return g.response;
  const id = parseId((await params).id);
  const topic = id === null ? null : await getTopic(id, g.member);
  if (!topic) return Response.json({ error: "Not found" }, { status: 404 });
  const replies = await listReplies(topic.id, g.member, {
    sort: parseReplySort(new URL(req.url).searchParams.get("ordem")),
    canModerate: topic.canModerate,
    acceptedReplyId: topic.acceptedReplyId,
  });
  return Response.json({ replies });
}

export async function POST(req: Request, { params }: Ctx) {
  const g = await requireMember();
  if ("response" in g) return g.response;
  const id = parseId((await params).id);
  if (id === null) return Response.json({ error: "Not found" }, { status: 404 });
  const limited = limitOrNull(req, "topic-reply", g.member.id);
  if (limited) return limited;
  const body = await req.json().catch(() => null);
  try {
    const reply = await createReply(id, g.member, { body: body?.body, parentId: body?.parentId ?? null });
    return Response.json({ reply }, { status: 201 });
  } catch (e) {
    return topicErrorResponse(e);
  }
}
