import { canMessage, listMessages } from "@/lib/dm";
import { errorResponse, threadGuard, type IdCtx } from "../http";

// GET /api/dm/[id]?antes=: as mensagens da thread em ordem crescente (50
// por página, `antes` é o cursor pras mais antigas) — e marca a leitura,
// porque abrir a conversa é ler. O DmThread chama a cada 15s com a aba
// visível. Thread alheia dá 404, nunca 403.
// `falar` diz se o compositor aparece: conversa aberta, sem bloqueio novo
// e com o outro lado ainda dentro do canNetwork (mensagem não depende do
// laço continuar existindo — quem abriu, conversa até bloquear).

export async function GET(req: Request, ctx: IdCtx) {
  const g = await threadGuard(ctx);
  if ("response" in g) return g.response;
  try {
    const antesN = Number(new URL(req.url).searchParams.get("antes"));
    const antes = Number.isSafeInteger(antesN) && antesN > 0 ? antesN : null;
    const page = await listMessages(g.me.id, g.thread.id, antes);
    if (!page) return Response.json({ error: "Não encontrado." }, { status: 404 });
    const lock = await canMessage(g.me.id, g.peer.id);
    return Response.json({
      thread: {
        id: g.thread.id,
        status: g.thread.status,
        iRequested: g.thread.requestedBy === g.me.id,
        peer: g.peer,
      },
      messages: page.messages,
      mais: page.mais,
      falar: g.thread.status === "aberta" && lock.estado !== "bloqueado",
      motivo: lock.motivo,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
