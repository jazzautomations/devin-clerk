import { cronAuthorized } from "@/lib/cronAuth";
import { runDigest } from "@/lib/digest";

// Resumo semanal por e-mail (migration 040). Segunda 12:00 UTC pelo
// deploy/digest.sh. Idempotente por (pessoa, semana): rodar de novo só
// tenta quem falhou. Sem RESEND_API_KEY grava 'pulado' e responde 200.
export async function POST(req: Request) {
  if (!cronAuthorized(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json(await runDigest(new Date()));
}
