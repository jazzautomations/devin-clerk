import { requireMember } from "@/lib/communityAuth";
import { parseId } from "@/lib/ids";
import { limitOrNull } from "@/lib/ratelimit";
import { deleteTopic, getTopic, listReplies, parseReplySort, topicErrorResponse, updateTopic } from "@/lib/topics";

// Um tópico (migration 058). GET devolve o tópico e a árvore de respostas
// (?ordem=melhores|novas). PATCH: autor edita título/corpo/flair; moderação
// fixa, tranca e troca flair. DELETE: autor apaga o próprio, moderação
// remove (a árvore fica).

type Ctx = { params: Promise<{ id: string }> };

const notFound = () => Response.json({ error: "Not found" }, { status: 404 });

export async function GET(req: Request, { params }: Ctx) {
  const g = await requireMember();
  if ("response" in g) return g.response;
  const id = parseId((await params).id);
  const topic = id === null ? null : await getTopic(id, g.member);
  if (!topic) return notFound();
  const replies = await listReplies(topic.id, g.member, {
    sort: parseReplySort(new URL(req.url).searchParams.get("ordem")),
    canModerate: topic.canModerate,
    acceptedReplyId: topic.acceptedReplyId,
  });
  return Response.json({ topic, replies });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const g = await requireMember();
  if ("response" in g) return g.response;
  const id = parseId((await params).id);
  if (id === null) return notFound();
  const limited = limitOrNull(req, "topic-edit", g.member.id);
  if (limited) return limited;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return Response.json({ error: "Nada pra mudar." }, { status: 400 });
  try {
    await updateTopic(id, g.member, body);
    return Response.json({ topic: await getTopic(id, g.member) });
  } catch (e) {
    return topicErrorResponse(e);
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  const g = await requireMember();
  if ("response" in g) return g.response;
  const id = parseId((await params).id);
  if (id === null) return notFound();
  const limited = limitOrNull(req, "topic-edit", g.member.id);
  if (limited) return limited;
  try {
    return Response.json({ result: await deleteTopic(id, g.member) });
  } catch (e) {
    return topicErrorResponse(e);
  }
}
