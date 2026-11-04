import { FollowThroughFailure, openFollowThrough } from "@/lib/followThrough";
import { limitOrNull } from "@/lib/ratelimit";
import { currentMember } from "@/lib/session";

// 4 semanas depois (spec 046, onda 5, migration 052). POST abre o período:
// { weeks?: 2..8, startsAt?: "2026-11-14T09:00" (Brasília), demoMeetupId? }.
// Só quem organiza a edição abre (hasEditionRole / canManageEdition), até 30
// dias depois do fim e com o início nos próximos 14 dias. 401 deslogado.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentMember();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const limited = limitOrNull(req, "follow-through", me.id);
  if (limited) return limited;
  const body = await req.json().catch(() => null);
  try {
    const followThrough = await openFollowThrough({ id: me.id, role: me.role }, id, body ?? {});
    return Response.json({ followThrough }, { status: 201 });
  } catch (e) {
    if (e instanceof FollowThroughFailure) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
