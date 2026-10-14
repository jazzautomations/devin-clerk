import { after } from "next/server";
import { processDeliveries } from "@/lib/announcements";
import { requireEditionManager } from "@/lib/editionAuth";
import { deleteScheduleItem, toEditorItem, updateScheduleItem, validateScheduleInput } from "@/lib/schedule";

// Editar/remover item da programação. Mudar horário/sala de item publicado
// gera aviso automático pros afetados; o envio roda em after(), como em avisos.

type Ctx = { params: Promise<{ id: string; itemId: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const { id, itemId } = await params;
  const g = await requireEditionManager(id);
  if ("response" in g) return g.response;
  let input;
  try {
    input = validateScheduleInput(await req.json().catch(() => null), g.hackathon);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
  const r = await updateScheduleItem(id, Number(itemId), input, g.member.id);
  if (!r) return Response.json({ error: "Item não encontrado" }, { status: 404 });
  if (r.announcementId !== null) {
    after(async () => {
      try {
        await processDeliveries(500);
      } catch (e) {
        console.error("[schedule] envio do aviso de mudança falhou", e);
      }
    });
  }
  return Response.json({ item: toEditorItem(r.item), announcementId: r.announcementId });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id, itemId } = await params;
  const g = await requireEditionManager(id);
  if ("response" in g) return g.response;
  if (!(await deleteScheduleItem(id, Number(itemId)))) {
    return Response.json({ error: "Item não encontrado" }, { status: 404 });
  }
  return Response.json({ ok: true });
}
