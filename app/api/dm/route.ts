import { currentMember } from "@/lib/session";
import { listThreads, startConversation, unreadDmCount } from "@/lib/dm";
import { errorResponse, resolveMember, unauthorized } from "./http";

// Mensagem direta com trava (migration 056).
// GET: a caixa de entrada — conversas abertas, pedidos recebidos, pedidos
// que eu mandei e o total de não lidas. `?resumo=1` devolve só o número
// (é o que o selo do header pede a cada minuto).
// POST {username, body}: começa a conversa. Com laço (seguir mútuo, mesmo
// time, encontro confirmado ou vaga aceita) abre direto e manda a mensagem
// (até 2000); sem laço vira pedido de até 280 esperando aceite. 404 pra
// pessoa inexistente ou com bloqueio, 409 pra pedido pendente, 400 pra
// texto fora do limite ou recusa em menos de 30 dias, 429 nos limites
// (mensagem 120/h, pedido 5/dia — o balde é escolhido dentro do lib).
// 401 deslogado.

export async function GET(req: Request) {
  const me = await currentMember();
  if (!me) return unauthorized();
  if (new URL(req.url).searchParams.get("resumo") === "1") {
    return Response.json({ unread: await unreadDmCount(me.id) });
  }
  const box = await listThreads(me.id);
  return Response.json(box);
}

export async function POST(req: Request) {
  const me = await currentMember();
  if (!me) return unauthorized();
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return Response.json({ error: "Corpo inválido." }, { status: 400 });
  const other = await resolveMember(b.username);
  if (!other) return Response.json({ error: "Pessoa não encontrada." }, { status: 404 });
  try {
    const r = await startConversation(me, other, b.body);
    return Response.json({ ok: true, threadId: r.thread.id, status: r.status }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
