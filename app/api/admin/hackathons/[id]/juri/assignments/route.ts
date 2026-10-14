import { assignAll, assignJudge, unassignJudge } from "@/lib/jury";
import { body, editionGate, json, juryErrorResponse } from "@/lib/juryHttp";

type Ctx = { params: Promise<{ id: string }> };

// atribuição jurado↔projeto — só organização. {all: true} atribui todo
// jurado a todo time, pulando conflito de interesse (+ finalistsOnly: rodada
// final só com finalistas — spec 034).
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const gate = await editionGate(id, true);
  if (!gate.ok) return gate.res;
  const b = await body(req);
  try {
    if (b.all === true) return json(await assignAll(id, { finalistsOnly: b.finalistsOnly === true }));
    await assignJudge(id, Number(b.judgeMemberId), Number(b.teamId));
    return json({ ok: true });
  } catch (e) {
    return juryErrorResponse(e);
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  const { id } = await params;
  const gate = await editionGate(id, true);
  if (!gate.ok) return gate.res;
  const b = await body(req);
  await unassignJudge(id, Number(b.judgeMemberId), Number(b.teamId));
  return json({ ok: true });
}
