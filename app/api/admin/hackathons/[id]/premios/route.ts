import { entryErrorResponse } from "@/lib/entriesHttp";
import { body, editionGate, json } from "@/lib/juryHttp";
import { createCategory, listCategories } from "@/lib/prizes";

type Ctx = { params: Promise<{ id: string }> };

// categorias de prêmio da edição (spec 034): geral ou desafio patrocinado
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const gate = await editionGate(id, true);
  if (!gate.ok) return gate.res;
  return json({ categories: await listCategories(id) });
}

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const gate = await editionGate(id, true);
  if (!gate.ok) return gate.res;
  try {
    return json({ category: await createCategory(id, await body(req)) }, 201);
  } catch (e) {
    return entryErrorResponse(e);
  }
}
