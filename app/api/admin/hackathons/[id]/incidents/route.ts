import { requireIncidentHandler } from "@/lib/incidentAuth";
import { listIncidents } from "@/lib/incidents";

// fila de incidentes da edição — organizador/admin e responsáveis de conduta
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await requireIncidentHandler(id);
  if ("response" in g) return g.response;
  return Response.json({ incidents: await listIncidents(id) });
}
