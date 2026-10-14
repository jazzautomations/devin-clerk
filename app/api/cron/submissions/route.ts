import { cronAuthorized } from "@/lib/cronAuth";
import { runEntryReminders } from "@/lib/entryReminders";

// spec 034 — lembretes da entrega (T-24h/T-3h/T-30min pra time em rascunho)
// e aviso de trava. Idempotente; os avisos saem pela fila de deliveries
// (cron /api/cron/deliveries). Protegido por Bearer $HACKAHUB_CRON_SECRET.
export async function POST(req: Request) {
  if (!cronAuthorized(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json(await runEntryReminders());
}
