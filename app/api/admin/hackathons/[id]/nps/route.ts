import { requireEditionManager } from "@/lib/editionAuth";
import { getNpsSummary, getNpsWindow, npsPhase, NpsError, setNpsClosesAt, type NpsWindow } from "@/lib/nps";

// Painel do NPS (roadmap 037 #11) — só organizador / admin global. Anônimo:
// a resposta nunca sai com memberId nem data.
const view = (w: NpsWindow | null) => ({
  opensAt: w?.opensAt?.toISOString() ?? null,
  closesAt: w?.closesAt?.toISOString() ?? null,
  custom: w?.custom ?? false,
  phase: w ? npsPhase(w) : "antes",
});

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await requireEditionManager(id);
  if ("response" in g) return g.response;
  const [w, summary] = await Promise.all([getNpsWindow(id), getNpsSummary(id)]);
  return Response.json({ window: view(w), summary }, { headers: { "Cache-Control": "no-store" } });
}

// {closesAt: "AAAA-MM-DDTHH:MM" (Brasília)} ou null pra voltar ao fim + 7 dias
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await requireEditionManager(id);
  if ("response" in g) return g.response;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body) || !("closesAt" in body)) {
    return Response.json({ error: "envie closesAt (ou null)" }, { status: 400 });
  }
  try {
    return Response.json({ window: view(await setNpsClosesAt(id, (body as { closesAt: unknown }).closesAt)) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof NpsError ? e.status : 400 });
  }
}
