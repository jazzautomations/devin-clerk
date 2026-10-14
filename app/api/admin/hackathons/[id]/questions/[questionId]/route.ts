import { requireEditionManager } from "@/lib/editionAuth";
import {
  isQuestionKind,
  moveQuestion,
  setQuestionArchived,
  updateQuestion,
} from "@/lib/registrationForm";

// edita (versiona se já tem resposta), arquiva/desarquiva ou move a pergunta.
// Corpo: { label?, kind?, options?, required? } | { archived } | { move: "up"|"down" }
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; questionId: string }> },
) {
  const { id, questionId } = await params;
  const g = await requireEditionManager(id);
  if ("response" in g) return g.response;
  const qid = Number(questionId);
  if (!Number.isInteger(qid) || qid <= 0) {
    return Response.json({ error: "Pergunta não encontrada" }, { status: 404 });
  }
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return Response.json({ error: "corpo inválido" }, { status: 400 });

  if (b.move === "up" || b.move === "down") {
    await moveQuestion(id, qid, b.move);
    return Response.json({ ok: true });
  }
  if (typeof b.archived === "boolean") {
    const question = await setQuestionArchived(id, qid, b.archived);
    if (!question) return Response.json({ error: "Pergunta não encontrada" }, { status: 404 });
    return Response.json({ question });
  }
  if (b.kind !== undefined && !isQuestionKind(b.kind)) {
    return Response.json({ error: "tipo de pergunta inválido" }, { status: 400 });
  }
  try {
    const question = await updateQuestion(id, qid, {
      kind: isQuestionKind(b.kind) ? b.kind : undefined,
      label: typeof b.label === "string" ? b.label : undefined,
      options: Array.isArray(b.options)
        ? b.options.filter((o): o is string => typeof o === "string")
        : undefined,
      required: typeof b.required === "boolean" ? b.required : undefined,
    });
    if (!question) return Response.json({ error: "Pergunta não encontrada" }, { status: 404 });
    return Response.json({ question });
  } catch (e) {
    // updateQuestion só lança por validação (texto vazio, opções insuficientes)
    return Response.json({ error: e instanceof Error ? e.message : "inválido" }, { status: 400 });
  }
}
