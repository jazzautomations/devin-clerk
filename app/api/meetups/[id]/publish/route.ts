import { MEETUP_ACTION_LIMITS, isMeetupOver, publishMeetup, requireMeetup } from "@/lib/meetups";
import { limitOrNull } from "@/lib/ratelimit";

// POST: publica o rascunho e avisa membros e quem segue. Uma vez só.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await requireMeetup(id, "manage");
  if ("response" in g) return g.response;
  const limited = limitOrNull(req, "meetups-manage", g.member.id, MEETUP_ACTION_LIMITS.manage);
  if (limited) return limited;
  if (g.meetup.publishedAt) return Response.json({ error: "Este evento já está publicado." }, { status: 409 });
  if (g.meetup.communityHidden) {
    return Response.json({ error: "Comunidade escondida pela moderação não publica." }, { status: 409 });
  }
  if (isMeetupOver(g.meetup)) return Response.json({ error: "A data já passou. Edite antes de publicar." }, { status: 409 });
  const r = await publishMeetup(g.meetup.id, g.member.id);
  if (!r) return Response.json({ error: "Este evento já está publicado." }, { status: 409 });
  return Response.json({ published: true, notified: r.notified });
}
