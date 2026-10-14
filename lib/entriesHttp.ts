import { EntryError } from "@/lib/entries";
import { forbidden, json } from "@/lib/juryHttp";
import { PrizeError } from "@/lib/prizes";
import { hasEditionRole } from "@/lib/roles";

// cola HTTP das rotas de entrega/prêmios do painel (spec 034)

export function entryErrorResponse(e: unknown): Response {
  if (e instanceof EntryError) {
    return json({ error: e.message, ...(e.missing ? { missing: e.missing } : {}) }, e.status);
  }
  if (e instanceof PrizeError) return json({ error: e.message }, e.status);
  throw e;
}

/** staff da edição (organizador e admin valem) — vídeo do palco */
export async function staffOrForbidden(member: { id: number; role: string }, hackathonId: string) {
  return (await hasEditionRole(member, hackathonId, "staff")) ? null : forbidden();
}
