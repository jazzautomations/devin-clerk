import { requireMember } from "@/lib/communityAuth";
import { parseId } from "@/lib/ids";
import { limitOrNull } from "@/lib/ratelimit";
import { topicErrorResponse, voteReply } from "@/lib/topics";

// Voto numa resposta ({value: 1 | -1 | 0}). Membro da comunidade, nunca na
// própria. Não dá XP. Devolve {score, myVote}.

type Ctx = { params: Promise<{ id: string; replyId: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const g = await requireMember();
  if ("response" in g) return g.response;
  const p = await params;
  const id = parseId(p.id);
  const replyId = parseId(p.replyId);
  if (id === null || replyId === null) return Response.json({ error: "Not found" }, { status: 404 });
  const limited = limitOrNull(req, "topic-vote", g.member.id);
  if (limited) return limited;
  const body = await req.json().catch(() => null);
  try {
    return Response.json(await voteReply(id, replyId, g.member, body?.value));
  } catch (e) {
    return topicErrorResponse(e);
  }
}
