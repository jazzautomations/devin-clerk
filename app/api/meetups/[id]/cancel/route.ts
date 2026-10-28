import { MEETUP_ACTION_LIMITS, cancelMeetup, meetupErrorResponse, requireMeetup } from "@/lib/meetups";
import { limitOrNull } from "@/lib/ratelimit";

// POST: cancela o evento publicado e avisa quem respondeu
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await requireMeetup(id, "manage");
  if ("response" in g) return g.response;
  const limited = limitOrNull(req, "meetups-manage", g.member.id, MEETUP_ACTION_LIMITS.manage);
  if (limited) return limited;
  try {
    const r = await cancelMeetup(g.meetup, g.member.id);
    return Response.json({ cancelled: true, notified: r.notified });
  } catch (e) {
    return meetupErrorResponse(e);
  }
}
