import { requireEditionManager } from "@/lib/editionAuth";
import {
  createQuestion,
  isAudience,
  listQuestions,
  validateQuestionInput,
  type Audience,
} from "@/lib/registrationForm";

// spec 033 US1 — perguntas do formulário da edição (organizador). Frente E:
// cada público (participante, voluntario, mentor, jurado) tem o próprio
// formulário — ?audience= no GET, { audience } no POST; default participante.
function audienceOf(raw: unknown): Audience | null {
  if (raw === undefined || raw === null || raw === "") return "participante";
  return isAudience(raw) ? raw : null;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await requireEditionManager(id);
  if ("response" in g) return g.response;
  const audience = audienceOf(new URL(req.url).searchParams.get("audience"));
  if (!audience) return Response.json({ error: "público inválido" }, { status: 400 });
  return Response.json({ questions: await listQuestions(id, { includeArchived: true, audience }) });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await requireEditionManager(id);
  if ("response" in g) return g.response;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const audience = audienceOf(body?.audience);
  if (!audience) return Response.json({ error: "público inválido" }, { status: 400 });
  const v = validateQuestionInput(body);
  if (!v.ok) return Response.json({ error: v.error }, { status: 400 });
  const question = await createQuestion(id, { ...v.value, audience });
  return Response.json({ question }, { status: 201 });
}
