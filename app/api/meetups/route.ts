import { requireCommunityManager } from "@/lib/communityAuth";
import { createMeetup, meetupErrorResponse, parseMeetupInput } from "@/lib/meetups";
import { limitOrNull } from "@/lib/ratelimit";

// POST: dono/organizador da comunidade (ou admin global) marca um evento na
// agenda. { community: slug, kind, title, startsAt, …, publish? }. Nasce
// rascunho; com publish: true já publica e avisa quem segue. 10 por dia.
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const slug = b && typeof b.community === "string" ? b.community.trim() : "";
  const g = await requireCommunityManager(slug);
  if ("response" in g) return g.response;
  if (!b) return Response.json({ error: "corpo da requisição inválido" }, { status: 400 });
  const limited = limitOrNull(req, "meetups", g.member.id);
  if (limited) return limited;
  const parsed = parseMeetupInput(b);
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });
  try {
    const r = await createMeetup(g.community, g.member.id, parsed.value, { publish: b.publish === true });
    return Response.json(
      { id: r.id, href: `/agenda/${r.id}`, published: b.publish === true, notified: r.notified },
      { status: 201 },
    );
  } catch (e) {
    return meetupErrorResponse(e);
  }
}
