import { notFound } from "next/navigation";
import { currentMember } from "@/lib/session";
import { canModerateQuestions, listQuestions } from "@/lib/questions";
import { formatDbTime } from "@/lib/format";
import { QuestionThread } from "@/components/QuestionThread";

// spec 033 US3 — aba de dúvidas do painel (organizador/mentor): abertas
// primeiro, responder e resolver no mesmo lugar.
export default async function AdminDuvidasPage({ params }: PageProps<"/admin/h/[id]/duvidas">) {
  const { id } = await params;
  const member = await currentMember();
  if (!(await canModerateQuestions(member, id))) notFound();
  const questions = (await listQuestions(id)).map((q) => ({ ...q, when: formatDbTime(q.createdAt) }));
  return (
    <section className="flex max-w-3xl flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-[1.6rem] leading-none font-extrabold tracking-[-0.03em]">Dúvidas dos inscritos</h2>
        <p className="text-[14px] text-muted">Quem perguntou recebe notificação quando você responde.</p>
      </div>
      <QuestionThread hackathonId={id} questions={questions} canAsk={false} canModerate />
    </section>
  );
}
