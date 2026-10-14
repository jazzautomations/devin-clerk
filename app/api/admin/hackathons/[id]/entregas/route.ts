import {
  getSubmissionSettings,
  listEntriesForAdmin,
  listEntryEvents,
  updateSubmissionSettings,
} from "@/lib/entries";
import { entryErrorResponse, staffOrForbidden } from "@/lib/entriesHttp";
import { body, editionGate, json } from "@/lib/juryHttp";

type Ctx = { params: Promise<{ id: string }> };

// painel de entregas (spec 034): quem entregou, quem não, log; staff lê
// (precisa da lista pra pôr o vídeo do palco), só organização configura.
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const gate = await editionGate(id, false);
  if (!gate.ok) return gate.res;
  const denied = await staffOrForbidden(gate.member, id);
  if (denied) return denied;
  const [settings, entries, events] = await Promise.all([
    getSubmissionSettings(id),
    listEntriesForAdmin(id),
    listEntryEvents(id),
  ]);
  return json({ settings, entries, events });
}

// prazos (datetime-local em Brasília), tolerância e obrigatórios
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const gate = await editionGate(id, true);
  if (!gate.ok) return gate.res;
  try {
    return json({ settings: await updateSubmissionSettings(id, await body(req)) });
  } catch (e) {
    return entryErrorResponse(e);
  }
}
