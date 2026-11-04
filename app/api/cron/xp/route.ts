import { cronAuthorized } from "@/lib/cronAuth";
import { syncAllUnlocks } from "@/lib/mascote/evolucao";
import { recomputeAll } from "@/lib/xp";

// Nível por entrega (spec 046, migration 035): recalcula members.xp de todo
// mundo a partir dos fatos verificados (lib/evidence.ts). Depois fecha o
// ciclo do bicho (migration 047): item novo vira notificação uma vez e, pra
// quem usa o bicho como avatar, o avatarUrl é regravado com o hash novo.
// Idempotente — uma vez por hora (deploy/xp.sh, linha em deploy/crontab.txt).
export async function POST(req: Request) {
  if (!cronAuthorized(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const xp = await recomputeAll();
  const bicho = await syncAllUnlocks();
  return Response.json({ ...xp, bicho });
}
