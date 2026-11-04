import { requireMember } from "@/lib/communityAuth";
import { parseId } from "@/lib/ids";
import { limitOrNull } from "@/lib/ratelimit";
import { topicErrorResponse, votePoll } from "@/lib/topics";

// Voto na enquete ({optionId}). Um por pessoa: votar de novo troca a opção.
// Tópico trancado encerra a enquete. Devolve {poll}.

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const g = await requireMember();
  if ("response" in g) return g.response;
  const id = parseId((await params).id);
  if (id === null) return Response.json({ error: "Not found" }, { status: 404 });
  const limited = limitOrNull(req, "topic-vote", g.member.id);
  if (limited) return limited;
  const body = await req.json().catch(() => null);
  try {
    return Response.json({ poll: await votePoll(id, g.member, body?.optionId) });
  } catch (e) {
    return topicErrorResponse(e);
  }
}
