import { removeCriterion, updateCriterion } from "@/lib/jury";
import { body, editionGate, json, juryErrorResponse } from "@/lib/juryHttp";

type Ctx = { params: Promise<{ id: string; criterionId: string }> };

// mudar peso não toca nota: o ranking é recalculado na leitura
export async function PATCH(req: Request, { params }: Ctx) {
  const { id, criterionId } = await params;
  const gate = await editionGate(id, true);
  if (!gate.ok) return gate.res;
  const b = await body(req);
  try {
    return json({ criterion: await updateCriterion(id, Number(criterionId), { label: b.label, weight: b.weight }) });
  } catch (e) {
    return juryErrorResponse(e);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id, criterionId } = await params;
  const gate = await editionGate(id, true);
  if (!gate.ok) return gate.res;
  try {
    await removeCriterion(id, Number(criterionId));
    return json({ ok: true });
  } catch (e) {
    return juryErrorResponse(e);
  }
}
