import { FollowThroughFailure, closeFollowThrough } from "@/lib/followThrough";
import { limitOrNull } from "@/lib/ratelimit";
import { currentMember } from "@/lib/session";

// Encerrar as 4 semanas antes do prazo (spec 046, onda 5, migration 052):
// { reason } obrigatório — o motivo aparece na página dos times. Encerrar
// antes do fim não concede o selo. 401 deslogado, 403 quem não organiza.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentMember();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const limited = limitOrNull(req, "follow-through", me.id);
  if (limited) return limited;
  const body = (await req.json().catch(() => null)) as { reason?: unknown } | null;
  try {
    const followThrough = await closeFollowThrough({ id: me.id, role: me.role }, id, body?.reason ?? null);
    return Response.json({ followThrough });
  } catch (e) {
    if (e instanceof FollowThroughFailure) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
