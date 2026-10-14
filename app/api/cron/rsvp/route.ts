import { cronAuthorized } from "@/lib/cronAuth";
import { processRsvp } from "@/lib/rsvp";

// RSVP anti-no-show (migration 012): convida no D-7, expira no fim do D-3
// (vaga volta pra fila), lembra D-1 e H-2. Idempotente — rodar a cada 15 min:
// */15 * * * * curl -fsS -X POST -H "Authorization: Bearer $HACKAHUB_CRON_SECRET" <site>/api/cron/rsvp
export async function POST(req: Request) {
  if (!cronAuthorized(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json(await processRsvp(new Date()));
}
