import { copilotLlmConfigured, summarizeFacts } from "@/lib/copilot/answer";
import { EVALUATION_REPLY, isEvaluationAsk } from "@/lib/copilot/guard";
import {
  COPILOT_Q_MAX,
  COPILOT_Q_MIN,
  detectIntent,
  logCopilotQuery,
  retrieveFacts,
} from "@/lib/copilot/retrieve";
import { getHackathon } from "@/lib/hackathons";
import { limitOrNull, RATE_LIMITS, rateLimit } from "@/lib/ratelimit";
import { currentMember } from "@/lib/session";

// POST /api/copilot (spec 046, onda 6: copilot-do-arquivo, migration 055).
// {q, hackathonId?} → {id, intent, facts, summary|null}
// - logada (401 JSON), 30/h por membro (balde "copilot");
// - q de 3 a 300 caracteres; hackathonId opcional ancora na edição
//   (intenção regras lê prazo, programação, termos e desafios dela);
// - pedido de avaliação recebe a resposta fixa + similares, sem LLM;
// - resumo via LLM só com provider configurado e dentro da cota
//   "copilot-llm" (20/dia); estourada ou com erro, a resposta sai só com os
//   fatos — a feature nunca depende do LLM.
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
  const b = (body ?? {}) as { q?: unknown; hackathonId?: unknown };
  const q = typeof b.q === "string" ? b.q.trim().replace(/\s+/g, " ") : "";
  const len = [...q].length;
  if (len < COPILOT_Q_MIN) {
    return Response.json({ error: `Digite pelo menos ${COPILOT_Q_MIN} letras.` }, { status: 400 });
  }
  if (len > COPILOT_Q_MAX) {
    return Response.json({ error: `A pergunta vai até ${COPILOT_Q_MAX} caracteres.` }, { status: 400 });
  }
  const hackathonId = typeof b.hackathonId === "string" && b.hackathonId.trim() ? b.hackathonId.trim() : null;
  if (hackathonId) {
    const h = await getHackathon(hackathonId);
    if (!h || !h.active) return Response.json({ error: "Edição não encontrada." }, { status: 400 });
  }

  // guarda: pedido de avaliação vira resposta fixa + "já fizeram isso?"
  const evalAsk = isEvaluationAsk(q);
  const intent = evalAsk ? "similar" : detectIntent(q, !!hackathonId);
  const facts = await retrieveFacts(q, me, { hackathonId, intent });

  let summary: string | null = null;
  let usedLlm = 0;
  if (evalAsk) {
    summary = EVALUATION_REPLY;
  } else if (
    facts.length &&
    copilotLlmConfigured() &&
    rateLimit(`copilot-llm:${me.id}`, RATE_LIMITS["copilot-llm"]).ok
  ) {
    summary = await summarizeFacts(q, facts);
    usedLlm = summary ? 1 : 0;
  }

  const id = await logCopilotQuery(me.id, q, intent, facts.length, usedLlm === 1);
  return Response.json({ id, intent, facts, summary });
}
