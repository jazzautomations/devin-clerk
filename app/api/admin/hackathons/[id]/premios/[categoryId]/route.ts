import { entryErrorResponse } from "@/lib/entriesHttp";
import { editionGate, json } from "@/lib/juryHttp";
import { deleteCategory } from "@/lib/prizes";

type Ctx = { params: Promise<{ id: string; categoryId: string }> };

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id, categoryId } = await params;
  const gate = await editionGate(id, true);
  if (!gate.ok) return gate.res;
  try {
    await deleteCategory(id, Number(categoryId));
    return json({ ok: true });
  } catch (e) {
    return entryErrorResponse(e);
  }
}
