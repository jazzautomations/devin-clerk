import { reopenEntry, setFinalist, setStageVideo } from "@/lib/entries";
import { entryErrorResponse, staffOrForbidden } from "@/lib/entriesHttp";
import { body, editionGate, forbidden, json } from "@/lib/juryHttp";
import { canManageEdition } from "@/lib/roles";

type Ctx = { params: Promise<{ id: string; teamId: string }> };

// reabrir a entrega de um time — só organização, motivo obrigatório (log)
export async function POST(req: Request, { params }: Ctx) {
  const { id, teamId } = await params;
  const gate = await editionGate(id, true);
  if (!gate.ok) return gate.res;
  const b = await body(req);
  try {
    return json(await reopenEntry(id, Number(teamId), gate.member.id, { reason: b.reason, minutes: b.minutes }));
  } catch (e) {
    return entryErrorResponse(e);
  }
}

// {stageVideoUrl} = vídeo do palco (staff); {finalist} = rodada final (organização)
export async function PATCH(req: Request, { params }: Ctx) {
  const { id, teamId } = await params;
  const gate = await editionGate(id, false);
  if (!gate.ok) return gate.res;
  const b = await body(req);
  try {
    if (b.stageVideoUrl !== undefined) {
      const denied = await staffOrForbidden(gate.member, id);
      if (denied) return denied;
      await setStageVideo(id, Number(teamId), gate.member.id, b.stageVideoUrl);
      return json({ ok: true });
    }
    if (b.finalist !== undefined) {
      if (!(await canManageEdition(gate.member, id))) return forbidden();
      await setFinalist(id, Number(teamId), b.finalist);
      return json({ ok: true });
    }
    return json({ error: "nada pra atualizar" }, 400);
  } catch (e) {
    return entryErrorResponse(e);
  }
}
