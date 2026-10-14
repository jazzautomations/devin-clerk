import { auth } from "@clerk/nextjs/server";
import { getMemberByClerkId } from "@/lib/members";
import { answerQuestion, canModerateQuestions, getQuestion, validateQuestionBody } from "@/lib/questions";

// spec 033 US3 — organização e mentores respondem; o autor é notificado.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; qid: string }> },
) {
  const { userId } = await auth();
  const member = userId ? await getMemberByClerkId(userId) : null;
  if (!member) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id, qid } = await params;
  if (!(await canModerateQuestions(member, id))) {
    return Response.json({ error: "só organização e mentores respondem" }, { status: 403 });
  }
  const questionId = Number(qid);
  if (!Number.isInteger(questionId) || !(await getQuestion(id, questionId))) {
    return Response.json({ error: "dúvida não encontrada" }, { status: 404 });
  }
  const raw = (await req.json().catch(() => null)) as { body?: unknown } | null;
  let body: string;
  try {
    body = validateQuestionBody(raw?.body);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
  return Response.json({ id: await answerQuestion(id, questionId, member, body) });
}
