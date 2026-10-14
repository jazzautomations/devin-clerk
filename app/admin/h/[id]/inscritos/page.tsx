import { notFound } from "next/navigation";
import { canManageEdition } from "@/lib/roles";
import { currentMember } from "@/lib/session";
import { listQuestions, listRegistrantsWithAnswers } from "@/lib/registrationForm";
import { REGISTRANT_FILTERS, RegistrantsTable, type RegistrantFilter } from "@/components/RegistrantsTable";
import { getAttendanceSummaries } from "@/lib/rsvp";

// spec 033 US1 — inscritos da edição com as respostas do formulário e o
// aceite LGPD; exportação com uma coluna por pergunta. Só organizador/admin,
// que aprova e recusa aqui mesmo (?status=pending abre a fila de pedidos).
export default async function InscritosPage({ params, searchParams }: PageProps<"/admin/h/[id]/inscritos">) {
  const { id } = await params;
  const raw = (await searchParams).status;
  const filter = (REGISTRANT_FILTERS as readonly string[]).includes(String(raw)) ? (raw as RegistrantFilter) : null;
  const member = await currentMember();
  if (!(await canManageEdition(member, id))) notFound();
  const [questions, rows] = await Promise.all([
    listQuestions(id, { includeArchived: true }),
    listRegistrantsWithAnswers(id),
  ]);
  // histórico de presença em outras edições — informativo, nunca decide
  const attendance = await getAttendanceSummaries(rows.map((r) => r.memberId), id);
  return (
    <RegistrantsTable hackathonId={id} questions={questions} rows={rows} attendance={attendance} filter={filter} />
  );
}
