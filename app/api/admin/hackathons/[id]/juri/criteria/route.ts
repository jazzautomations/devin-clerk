import { addCriterion, listCriteria } from "@/lib/jury";
import { body, editionGate, json, juryErrorResponse } from "@/lib/juryHttp";

type Ctx = { params: Promise<{ id: string }> };

// rubrica da edição (spec 033 US5) — só organização
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const gate = await editionGate(id, true);
  if (!gate.ok) return gate.res;
  return json({ criteria: await listCriteria(id) });
}

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const gate = await editionGate(id, true);
  if (!gate.ok) return gate.res;
  const b = await body(req);
  try {
    return json({ criterion: await addCriterion(id, { label: b.label, weight: b.weight }) }, 201);
  } catch (e) {
    return juryErrorResponse(e);
  }
}
