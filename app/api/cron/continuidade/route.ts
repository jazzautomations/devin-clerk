import { cronAuthorized } from "@/lib/cronAuth";
import { runContinuity } from "@/lib/continuity";

// Selo "continuou" (spec 046, onda 3, migration 044). Cron mensal: re-coleta
// o dossiê dos times com repositório de edição encerrada há 30 a 400 dias e
// grava team_projects.continuedAt com a data do primeiro commit depois do fim
// da edição + 30 dias. Idempotente; a cota do GitHub é respeitada pelo dossiê
// (029) e cada execução olha no máximo 50 times, os mais antigos primeiro.
export async function POST(req: Request) {
  if (!cronAuthorized(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json(await runContinuity());
}
