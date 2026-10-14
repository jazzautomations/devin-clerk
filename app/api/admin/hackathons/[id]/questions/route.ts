import { requireEditionManager } from "@/lib/editionAuth";
import { createQuestion, listQuestions, validateQuestionInput } from "@/lib/registrationForm";

// spec 033 US1 — perguntas do formulário de inscrição da edição (organizador)
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await requireEditionManager(id);
  if ("response" in g) return g.response;
  return Response.json({ questions: await listQuestions(id, { includeArchived: true }) });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await requireEditionManager(id);
  if ("response" in g) return g.response;
  const v = validateQuestionInput(await req.json().catch(() => null));
  if (!v.ok) return Response.json({ error: v.error }, { status: 400 });
  const question = await createQuestion(id, v.value);
  return Response.json({ question }, { status: 201 });
}
