import { auth } from "@clerk/nextjs/server";
import { getMemberByClerkId } from "@/lib/members";
import { limitOrNull } from "@/lib/ratelimit";
import { askQuestion, canUseQuestions, listQuestions, validateQuestionBody } from "@/lib/questions";

// spec 033 US3 — thread de dúvidas: só inscritos (approved/pending) e papéis.

async function actor(id: string) {
  const { userId } = await auth();
  const member = userId ? await getMemberByClerkId(userId) : null;
  if (!member) return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!(await canUseQuestions(member, id))) {
    return { error: Response.json({ error: "só inscritos na edição" }, { status: 403 }) };
  }
  return { member };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await actor(id);
  if (a.error) return a.error;
  return Response.json({ questions: await listQuestions(id) });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const a = await actor(id);
  if (a.error) return a.error;
  const limited = limitOrNull(req, "questions", a.member.id);
  if (limited) return limited;
  const raw = (await req.json().catch(() => null)) as { body?: unknown } | null;
  let body: string;
  try {
    body = validateQuestionBody(raw?.body);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
  return Response.json({ id: await askQuestion(id, a.member.id, body) });
}
