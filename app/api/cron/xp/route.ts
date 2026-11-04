import { cronAuthorized } from "@/lib/cronAuth";
import { recomputeAll } from "@/lib/xp";

// Nível por entrega (spec 046, migration 035): recalcula members.xp de todo
// mundo a partir dos fatos verificados (lib/evidence.ts). Idempotente — uma
// vez por hora (deploy/xp.sh, linha em deploy/crontab.txt).
export async function POST(req: Request) {
  if (!cronAuthorized(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json(await recomputeAll());
}
