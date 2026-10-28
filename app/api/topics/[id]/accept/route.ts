import { requireMember } from "@/lib/communityAuth";
import { parseId } from "@/lib/ids";
import { limitOrNull } from "@/lib/ratelimit";
import { acceptReply, topicErrorResponse } from "@/lib/topics";

// Quem perguntou marca a resposta que resolveu ({replyId}) ou desmarca
// ({replyId: null}). Só em tópico do tipo pergunta.

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const g = await requireMember();
  if ("response" in g) return g.response;
  const id = parseId((await params).id);
  if (id === null) return Response.json({ error: "Not found" }, { status: 404 });
  const limited = limitOrNull(req, "topic-edit", g.member.id);
  if (limited) return limited;
  const body = await req.json().catch(() => null);
  try {
    return Response.json(await acceptReply(id, g.member, body?.replyId ?? null));
  } catch (e) {
    return topicErrorResponse(e);
  }
}
