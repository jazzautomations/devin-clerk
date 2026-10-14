import { requireEditionManager } from "@/lib/editionAuth";
import { getEditionTerms, saveEditionTerms, validateTermsPatch } from "@/lib/eventTerms";

// termos do evento (frente L): idade mínima, pergunta de dieta e código de
// conduta da edição. Só organizador/admin.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await requireEditionManager(id);
  if ("response" in g) return g.response;
  return Response.json(await getEditionTerms(id));
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await requireEditionManager(id);
  if ("response" in g) return g.response;
  const v = validateTermsPatch(await req.json().catch(() => null));
  if (!v.ok) return Response.json({ error: v.error }, { status: 400 });
  return Response.json(await saveEditionTerms(id, v.value, g.member.id));
}
