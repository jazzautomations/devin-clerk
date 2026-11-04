import { acceptRequest } from "@/lib/dm";
import { errorResponse, threadGuard, type IdCtx } from "../../http";

// POST /api/dm/[id]/accept: quem recebeu o pedido aceita — a conversa abre
// e quem pediu recebe a notificação 'dm'. 404 pra thread alheia, 400 pra
// conversa que não é pedido ou pro próprio pedido.

export async function POST(_req: Request, ctx: IdCtx) {
  const g = await threadGuard(ctx);
  if ("response" in g) return g.response;
  try {
    await acceptRequest(g.me, g.thread);
    return Response.json({ ok: true, status: "aberta" });
  } catch (e) {
    return errorResponse(e);
  }
}
