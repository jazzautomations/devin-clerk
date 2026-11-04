import { declineRequest } from "@/lib/dm";
import { errorResponse, threadGuard, type IdCtx } from "../../http";

// POST /api/dm/[id]/decline: recusa silenciosa — quem pediu não é avisado
// e só pode tentar de novo depois de 30 dias (declinedAt). 404 pra thread
// alheia, 400 pra conversa que não é pedido ou pro próprio pedido.

export async function POST(_req: Request, ctx: IdCtx) {
  const g = await threadGuard(ctx);
  if ("response" in g) return g.response;
  try {
    await declineRequest(g.me.id, g.thread);
    return Response.json({ ok: true, status: "recusada" });
  } catch (e) {
    return errorResponse(e);
  }
}
