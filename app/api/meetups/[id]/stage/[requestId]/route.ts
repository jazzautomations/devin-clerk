import { MEETUP_ACTION_LIMITS, decideStage, meetupErrorResponse, meetupIdParam, requireMeetup } from "@/lib/meetups";
import { limitOrNull } from "@/lib/ratelimit";

// PATCH { status: 'aceito' | 'recusado' }: dono/organizador decide o pedido
// de palco. Aceito entra na programação do demo day.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; requestId: string }> }) {
  const { id, requestId } = await params;
  const g = await requireMeetup(id, "manage");
  if ("response" in g) return g.response;
  const limited = limitOrNull(req, "meetups-manage", g.member.id, MEETUP_ACTION_LIMITS.manage);
  if (limited) return limited;
  const rid = meetupIdParam(requestId);
  if (!rid) return Response.json({ error: "Pedido não encontrado" }, { status: 404 });
  const b = (await req.json().catch(() => null)) as { status?: unknown } | null;
  try {
    return Response.json(await decideStage(g.meetup, rid, b?.status, g.member.id));
  } catch (e) {
    return meetupErrorResponse(e);
  }
}
