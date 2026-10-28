import { requireMember } from "@/lib/communityAuth";
import { parseId } from "@/lib/ids";
import { limitOrNull } from "@/lib/ratelimit";
import { topicErrorResponse, voteTopic } from "@/lib/topics";

// Voto no tópico ({value: 1 | -1 | 0}; 0 desfaz). Membro da comunidade,
// nunca no próprio. Não dá XP. Devolve {score, myVote}.

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
    return Response.json(await voteTopic(id, g.member, body?.value));
  } catch (e) {
    return topicErrorResponse(e);
  }
}
