import { getHackathon } from "@/lib/hackathons";
import { getStageSnapshot } from "@/lib/stage";

// Modo palco — snapshot público do palco (telão/celular). É o fallback de
// polling quando o SSE (./stream) não passa (proxy corporativo, rede ruim).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const h = await getHackathon(id);
  if (!h || !h.active) return Response.json({ error: "Edição não encontrada" }, { status: 404 });
  return Response.json(await getStageSnapshot(id), {
    headers: { "Cache-Control": "no-store" },
  });
}
