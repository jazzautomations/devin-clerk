import Link from "next/link";
import { notFound } from "next/navigation";
import { canManageEdition } from "@/lib/roles";
import { currentMember } from "@/lib/session";
import { getOpenKinds, listApplications } from "@/lib/roleApplications";
import { formatDbTime } from "@/lib/format";
import { ApplicationsBoard } from "@/components/ApplicationsBoard";

// frente E (spec 033) — candidaturas a voluntário/mentor/jurado (só
// organizador/admin): abre/fecha cada tipo, lê as respostas e decide.
// Aprovar concede o papel da edição na hora.
export default async function CandidaturasPage({ params }: PageProps<"/admin/h/[id]/candidaturas">) {
  const { id } = await params;
  const member = await currentMember();
  if (!(await canManageEdition(member, id))) notFound();
  const [applications, open] = await Promise.all([listApplications(id), getOpenKinds(id)]);
  const rows = applications.map((a) => ({ ...a, when: formatDbTime(a.createdAt) }));
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <p className="text-[14px] text-muted">
        Aprovar dá o papel na hora: voluntário vira staff (faz check-in), mentor responde dúvidas, jurado avalia
        projetos. Cada tipo tem o próprio formulário na aba{" "}
        <Link href={`/admin/h/${id}/formulario?publico=mentor`} className="text-accent underline">
          formulário
        </Link>
        .
      </p>
      <ApplicationsBoard hackathonId={id} applications={rows} open={open} />
    </div>
  );
}
