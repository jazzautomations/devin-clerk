import { requireEditionManager } from "@/lib/editionAuth";
import { setConductHandler } from "@/lib/incidents";

// só o organizador marca quem da equipe é responsável de conduta
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await requireEditionManager(id);
  if ("response" in g) return g.response;
  const body = (await req.json().catch(() => null)) as { memberId?: unknown; on?: unknown } | null;
  const memberId = Number(body?.memberId);
  if (!Number.isInteger(memberId) || memberId <= 0 || typeof body?.on !== "boolean") {
    return Response.json({ error: "memberId e on (true/false) são obrigatórios" }, { status: 400 });
  }
  if (!(await setConductHandler(id, memberId, body.on, g.member.id))) {
    return Response.json({ error: "só quem já é da equipe da edição" }, { status: 400 });
  }
  return Response.json({ ok: true });
}
