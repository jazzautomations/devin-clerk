import { auth } from "@clerk/nextjs/server";
import { getMemberByClerkId } from "@/lib/members";
import { canModerateQuestions, setQuestionResolved } from "@/lib/questions";

// spec 033 US3 — marcar/desmarcar dúvida como resolvida (organização/mentor)
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; qid: string }> },
) {
  const { userId } = await auth();
  const member = userId ? await getMemberByClerkId(userId) : null;
  if (!member) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id, qid } = await params;
  if (!(await canModerateQuestions(member, id))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const raw = (await req.json().catch(() => null)) as { resolved?: unknown } | null;
  if (typeof raw?.resolved !== "boolean") {
    return Response.json({ error: "resolved deve ser true/false" }, { status: 400 });
  }
  const questionId = Number(qid);
  const ok =
    Number.isInteger(questionId) &&
    (await setQuestionResolved(id, questionId, member.id, raw.resolved));
  if (!ok) return Response.json({ error: "dúvida não encontrada" }, { status: 404 });
  return Response.json({ ok: true });
}
