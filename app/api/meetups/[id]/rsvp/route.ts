import { MEETUP_ACTION_LIMITS, clearRsvp, meetupErrorResponse, requireMeetup, rsvpCounts, setRsvp } from "@/lib/meetups";
import { canNetwork } from "@/lib/network";
import { limitOrNull } from "@/lib/ratelimit";

type Ctx = { params: Promise<{ id: string }> };

// POST { status: 'vou' | 'talvez' }. Lotado: "vou" vira "talvez" e a
// resposta traz full: true e a mensagem "lotado".
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const g = await requireMeetup(id, "view");
  if ("response" in g) return g.response;
  const limited = limitOrNull(req, "meetups-rsvp", g.member.id, MEETUP_ACTION_LIMITS.rsvp);
  if (limited) return limited;
  const b = (await req.json().catch(() => null)) as { status?: unknown } | null;
  const status = b?.status;
  if (status !== "vou" && status !== "talvez") return Response.json({ error: "Responda vou ou talvez." }, { status: 400 });
  // responder abre o link da sala: superfície de contato
  if (!(await canNetwork(g.member.id))) {
    return Response.json({ error: "Sua conta não pode responder agora." }, { status: 403 });
  }
  try {
    const r = await setRsvp(g.meetup, g.member.id, status);
    return Response.json({
      status: r.status,
      full: r.full,
      ...(r.full ? { message: "lotado" } : {}),
      counts: await rsvpCounts(g.meetup.id),
    });
  } catch (e) {
    return meetupErrorResponse(e);
  }
}

// DELETE: tira a resposta
export async function DELETE(req: Request, { params }: Ctx) {
  const { id } = await params;
  const g = await requireMeetup(id, "view");
  if ("response" in g) return g.response;
  const limited = limitOrNull(req, "meetups-rsvp", g.member.id, MEETUP_ACTION_LIMITS.rsvp);
  if (limited) return limited;
  const removed = await clearRsvp(g.meetup.id, g.member.id);
  return Response.json({ status: null, removed, counts: await rsvpCounts(g.meetup.id) });
}
