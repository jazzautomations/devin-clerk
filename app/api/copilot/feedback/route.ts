import { setCopilotFeedback } from "@/lib/copilot/retrieve";
import { limitOrNull } from "@/lib/ratelimit";
import { currentMember } from "@/lib/session";

// POST /api/copilot/feedback — o voto "ajudou?" da resposta (migration 055).
// {id, helpful:boolean} → grava helpful na própria copilot_queries; só a
// pessoa que fez a pergunta vota (404 se o id não é dela). Divide o balde
// "copilot" com a pergunta.
export async function POST(req: Request) {
  const me = await currentMember();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const limited = limitOrNull(req, "copilot", me.id);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Corpo inválido." }, { status: 400 });
  }
  const b = (body ?? {}) as { id?: unknown; helpful?: unknown };
  const id = typeof b.id === "number" && Number.isInteger(b.id) && b.id > 0 ? b.id : null;
  const helpful = typeof b.helpful === "boolean" ? b.helpful : null;
  if (id === null || helpful === null) {
    return Response.json({ error: "Feedback inválido." }, { status: 400 });
  }
  const ok = await setCopilotFeedback(id, me.id, helpful);
  if (!ok) return Response.json({ error: "Pergunta não encontrada." }, { status: 404 });
  return Response.json({ ok: true });
}
