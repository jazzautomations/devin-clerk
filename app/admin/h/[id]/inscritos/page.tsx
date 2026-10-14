import { notFound } from "next/navigation";
import { canManageEdition } from "@/lib/roles";
import { currentMember } from "@/lib/session";
import { listQuestions, listRegistrantsWithAnswers } from "@/lib/registrationForm";
import { RegistrantsTable } from "@/components/RegistrantsTable";

// spec 033 US1 — inscritos da edição com as respostas do formulário e o
// aceite LGPD; CSV com uma coluna por pergunta. Só organizador/admin.
export default async function InscritosPage({ params }: PageProps<"/admin/h/[id]/inscritos">) {
  const { id } = await params;
  const member = await currentMember();
  if (!(await canManageEdition(member, id))) notFound();
  const [questions, rows] = await Promise.all([
    listQuestions(id, { includeArchived: true }),
    listRegistrantsWithAnswers(id),
  ]);
  return <RegistrantsTable hackathonId={id} questions={questions} rows={rows} />;
}
