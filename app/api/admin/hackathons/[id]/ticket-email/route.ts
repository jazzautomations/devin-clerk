import { requireEditionManager } from "@/lib/editionAuth";
import { limitOrNull } from "@/lib/ratelimit";
import { getTicketEmailStatus, requeueTicketEmail } from "@/lib/ticketEmail";

// Reenvio manual do e-mail com o QR do ingresso (só organizador). O envio
// automático acontece uma vez por inscrição, na aprovação.
const HOUR = 3_600_000;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await requireEditionManager(id);
  if ("response" in g) return g.response;
  const limited = limitOrNull(req, "ticket-email", g.member.id, { limit: 60, windowMs: HOUR });
  if (limited) return limited;
  const b = (await req.json().catch(() => null)) as { registrationId?: unknown } | null;
  if (typeof b?.registrationId !== "number" || !Number.isSafeInteger(b.registrationId)) {
    return Response.json({ error: "mande {registrationId}" }, { status: 400 });
  }
  const r = await requeueTicketEmail(b.registrationId, id, g.member.id);
  if (r === "not_found") {
    return Response.json({ error: "Inscrição não encontrada nesta edição." }, { status: 404 });
  }
  if (r === "not_approved") {
    return Response.json({ error: "Só inscrição aprovada tem ingresso." }, { status: 409 });
  }
  return Response.json({
    message: "Ingresso na fila de reenvio por e-mail.",
    status: await getTicketEmailStatus(b.registrationId),
  });
}
