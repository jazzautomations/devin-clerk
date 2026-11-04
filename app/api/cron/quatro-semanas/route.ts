import { cronAuthorized } from "@/lib/cronAuth";
import { runFollowThrough } from "@/lib/followThrough";

// 4 semanas depois (spec 046, onda 5, migration 052). Cron diário: materializa
// as semanas de cada time inscrito, lembra na quinta o time sem atualização
// (uma vez por semana) e, no fim, concede o selo 'quatro-semanas' a quem
// fechou todas as semanas. Idempotente — deploy/quatro-semanas.sh, uma linha
// em deploy/crontab.txt.
export async function POST(req: Request) {
  if (!cronAuthorized(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json(await runFollowThrough());
}
