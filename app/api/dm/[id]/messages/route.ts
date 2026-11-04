import { sendMessage } from "@/lib/dm";
import { errorResponse, threadGuard, type IdCtx } from "../../http";

// POST /api/dm/[id]/messages {body}: manda mensagem numa conversa aberta.
// 404 pra thread alheia ou bloqueio em qualquer sentido, 400 pra conversa
// que ainda não abriu (pedido esperando resposta) ou texto fora de 1–2000,
// 429 no balde 'dm' (120/h por membro).

export async function POST(req: Request, ctx: IdCtx) {
  const g = await threadGuard(ctx);
  if ("response" in g) return g.response;
  try {
    const b = (await req.json().catch(() => null)) as { body?: unknown } | null;
    const msg = await sendMessage(g.me, g.thread, b?.body);
    return Response.json({ ok: true, message: msg }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
