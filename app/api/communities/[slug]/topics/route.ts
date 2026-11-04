import { requireCommunity } from "@/lib/communityAuth";
import { getMembership } from "@/lib/communities";
import { limitOrNull } from "@/lib/ratelimit";
import { createTopic, listFlairs, listTopics, parsePeriod, parseSort, topicErrorResponse, topicHref } from "@/lib/topics";

// Tópicos da comunidade (migration 058). GET lista (?ordem=em-alta|novos|
// top|sem-resposta, ?periodo=semana|mes|sempre, ?flair=, ?q=); POST abre
// tópico (membro da comunidade, 10/h). Deslogado: 401 JSON.

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const g = await requireCommunity((await params).slug);
  if ("response" in g) return g.response;
  const sp = new URL(req.url).searchParams;
  const role = await getMembership(g.community.id, g.member.id);
  const canModerate = g.member.role === "admin" || role === "dono" || role === "organizador";
  const [list, flairs] = await Promise.all([
    listTopics(g.community.id, g.member.id, {
      sort: parseSort(sp.get("ordem")),
      period: parsePeriod(sp.get("periodo")),
      flair: sp.get("flair"),
      q: sp.get("q"),
      includeRemoved: canModerate,
      canModerate,
    }),
    listFlairs(g.community.id),
  ]);
  return Response.json({ ...list, flairs, canPost: role !== null });
}

export async function POST(req: Request, { params }: Ctx) {
  const g = await requireCommunity((await params).slug);
  if ("response" in g) return g.response;
  const limited = limitOrNull(req, "topic-create", g.member.id);
  if (limited) return limited;
  const body = await req.json().catch(() => null);
  try {
    const id = await createTopic(g.community.id, g.member, body);
    return Response.json({ topic: { id, href: topicHref(g.community.slug, id) } }, { status: 201 });
  } catch (e) {
    return topicErrorResponse(e);
  }
}
