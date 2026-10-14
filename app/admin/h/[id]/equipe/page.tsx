import { notFound } from "next/navigation";
import { EditionTeamPanel } from "@/components/EditionTeamPanel";
import { EDITION_ROLES, canManageEdition, listEditionTeam, listPendingInvites } from "@/lib/roles";
import { currentMember } from "@/lib/session";

// Equipe da edição (spec 033 US7): só organizador (e admin global). O
// layout já barrou quem não tem papel nenhum; aqui barra staff/mentor/jurado.
export default async function EditionTeamPage({ params }: PageProps<"/admin/h/[id]/equipe">) {
  const { id } = await params;
  const member = await currentMember();
  if (!member || !(await canManageEdition(member, id))) notFound();
  const [team, invites] = await Promise.all([listEditionTeam(id), listPendingInvites(id)]);
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-[clamp(1.4rem,3vw,1.8rem)] leading-none font-extrabold tracking-[-0.03em]">
          Equipe da edição
        </h2>
        <p className="max-w-[60ch] text-[14px] text-muted">
          Quem opera esta edição. Staff faz check-in, mentor responde dúvidas, jurado avalia os
          projetos, organizador pode tudo. Convite pra e-mail sem conta vale no primeiro login.
        </p>
      </div>
      <EditionTeamPanel hackathonId={id} meId={member.id} roles={EDITION_ROLES} team={team} invites={invites} />
    </section>
  );
}
