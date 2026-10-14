import { requireIncidentHandler } from "@/lib/incidentAuth";
import { updateIncident, validateIncidentPatch } from "@/lib/incidents";

// status (aberto/em andamento/resolvido) e nota interna da denúncia
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; incidentId: string }> },
) {
  const { id, incidentId } = await params;
  const g = await requireIncidentHandler(id);
  if ("response" in g) return g.response;
  const n = Number(incidentId);
  if (!Number.isInteger(n) || n <= 0) return Response.json({ error: "Not found" }, { status: 404 });
  const v = validateIncidentPatch(await req.json().catch(() => null));
  if (!v.ok) return Response.json({ error: v.error }, { status: 400 });
  if (!(await updateIncident(id, n, v.value, g.member.id))) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json({ ok: true });
}
