import { requireEditionManager } from "@/lib/editionAuth";
import {
  createScheduleItem,
  duplicateScheduleItem,
  listScheduleItems,
  toEditorItem,
  validateScheduleInput,
} from "@/lib/schedule";

// Programação da edição (roadmap 037 #4) — organizador/admin.
// GET lista (com rascunhos); POST cria rascunho, ou {duplicateOf} copia um item.

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const g = await requireEditionManager(id);
  if ("response" in g) return g.response;
  const items = await listScheduleItems(id, { includeDrafts: true });
  return Response.json({ items: items.map(toEditorItem) });
}

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const g = await requireEditionManager(id);
  if ("response" in g) return g.response;
  const raw = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (raw && raw.duplicateOf !== undefined) {
    const copy = await duplicateScheduleItem(id, Number(raw.duplicateOf), g.member.id);
    if (!copy) return Response.json({ error: "Item não encontrado" }, { status: 404 });
    return Response.json({ item: toEditorItem(copy) }, { status: 201 });
  }
  let input;
  try {
    input = validateScheduleInput(raw, g.hackathon);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
  const item = await createScheduleItem(id, input, g.member.id);
  return Response.json({ item: toEditorItem(item) }, { status: 201 });
}
