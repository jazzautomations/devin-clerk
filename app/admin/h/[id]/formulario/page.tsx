import Link from "next/link";
import { notFound } from "next/navigation";
import { canManageEdition } from "@/lib/roles";
import { currentMember } from "@/lib/session";
import { getEditionCapacity } from "@/lib/registrations";
import { countCurrentAnswers, listQuestions } from "@/lib/registrationForm";
import { QuestionEditor } from "@/components/QuestionEditor";

// spec 033 US1 — aba "formulário" do painel da edição (só organizador/admin)
export default async function FormularioPage({ params }: PageProps<"/admin/h/[id]/formulario">) {
  const { id } = await params;
  const member = await currentMember();
  if (!(await canManageEdition(member, id))) notFound();
  const [questions, answered, cap] = await Promise.all([
    listQuestions(id, { includeArchived: true }),
    countCurrentAnswers(id),
    getEditionCapacity(id),
  ]);
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="font-mono text-[13px] text-muted">
          {cap.approved} {cap.approved === 1 ? "aprovado" : "aprovados"}
          {cap.capacity !== null && ` de ${cap.capacity} vagas`}
          {cap.waitlist > 0 && ` · ${cap.waitlist} na fila`}
        </p>
        <span className="flex gap-4 font-mono text-[13px]">
          <Link href={`/h/${id}/inscricao`} className="text-accent underline-offset-4 hover:underline">
            ver como o inscrito vê ↗
          </Link>
          <Link href={`/admin/h/${id}/inscritos`} className="text-accent underline-offset-4 hover:underline">
            inscritos e respostas →
          </Link>
        </span>
      </div>
      <QuestionEditor hackathonId={id} questions={questions} answered={answered} capacity={cap.capacity} />
    </div>
  );
}
