import { FollowThroughFailure, joinFollowThrough } from "@/lib/followThrough";
import { limitOrNull } from "@/lib/ratelimit";
import { currentMember } from "@/lib/session";

// Entrar nas 4 semanas com o time (spec 046, onda 5, migration 052):
// { teamId } de um time da edição que entregou projeto. Só integrante do time
// entra por ele, até o fim da semana 1. 201 quando entra, 200 quando já
// estava dentro (idempotente), e o time é avisado na primeira vez.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentMember();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const limited = limitOrNull(req, "follow-through", me.id);
  if (limited) return limited;
  const body = (await req.json().catch(() => null)) as { teamId?: unknown } | null;
  const teamId = Number(body?.teamId);
  if (!Number.isSafeInteger(teamId) || teamId <= 0) {
    return Response.json({ error: "Escolha o time." }, { status: 400 });
  }
  try {
    const r = await joinFollowThrough({ id: me.id, username: me.username }, id, teamId);
    return Response.json(r, { status: r.joined ? 201 : 200 });
  } catch (e) {
    if (e instanceof FollowThroughFailure) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
