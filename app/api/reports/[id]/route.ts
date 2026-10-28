import { resolveReport } from "@/lib/reports";
import { currentMember } from "@/lib/session";

// Resolver denúncia (migration 032): quem modera o espaço dela (dono ou
// organizador da comunidade, quem trata incidentes da edição, admin global).
// PATCH {resolution}: o que foi feito, em poucas palavras.

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentMember();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!/^\d{1,12}$/.test(id)) return Response.json({ error: "Denúncia não encontrada." }, { status: 404 });
  const b = (await req.json().catch(() => null)) as { resolution?: unknown } | null;
  const r = await resolveReport(Number(id), me, b?.resolution);
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
  return Response.json({ ok: true, report: r.report });
}
