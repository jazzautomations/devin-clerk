import { MEETUP_ACTION_LIMITS, meetupErrorResponse, requestStage, requireMeetup } from "@/lib/meetups";
import { canNetwork } from "@/lib/network";
import { limitOrNull } from "@/lib/ratelimit";

// POST { teamId, pitch }: pede palco no demo day com um projeto do próprio
// time. Projeto alheio dá 403.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await requireMeetup(id, "view");
  if ("response" in g) return g.response;
  const limited = limitOrNull(req, "meetups-stage", g.member.id, MEETUP_ACTION_LIMITS.stage);
  if (limited) return limited;
  const b = (await req.json().catch(() => null)) as { teamId?: unknown; pitch?: unknown } | null;
  if (!b) return Response.json({ error: "corpo da requisição inválido" }, { status: 400 });
  if (!(await canNetwork(g.member.id))) {
    return Response.json({ error: "Sua conta não pode pedir palco agora." }, { status: 403 });
  }
  try {
    const r = await requestStage(g.meetup, g.member, b.teamId, b.pitch);
    return Response.json({ id: r.id, status: "pedido" }, { status: 201 });
  } catch (e) {
    return meetupErrorResponse(e);
  }
}
