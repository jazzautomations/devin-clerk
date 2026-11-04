import { notFound } from "next/navigation";
import { EditionTeamPanel } from "@/components/EditionTeamPanel";
import { TeamBoardToggle } from "@/components/TeamBoardPanel";
import { EDITION_ROLES, canManageEdition, listEditionTeam, listPendingInvites } from "@/lib/roles";
import { currentMember } from "@/lib/session";
import { listAllBoardEntries } from "@/lib/teamboard";

// Equipe da edição (spec 033 US7): só organizador (e admin global). O
// layout já barrou quem não tem papel nenhum; aqui barra staff/mentor/jurado.
//
// spec 046 onda 3: a moderação do board "procuro time" também mora aqui —
// quem organiza a edição esconde/reativa anúncio sem depender do admin global.
export default async function EditionTeamPage({ params }: PageProps<"/admin/h/[id]/equipe">) {
  const { id } = await params;
  const member = await currentMember();
  if (!member || !(await canManageEdition(member, id))) notFound();
  const [team, invites, board] = await Promise.all([
    listEditionTeam(id),
    listPendingInvites(id),
    listAllBoardEntries(id),
  ]);
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

      <div className="flex flex-col gap-3">
        <h2 className="text-[clamp(1.2rem,2.6vw,1.5rem)] leading-none font-extrabold tracking-[-0.03em]">
          Mural procuro time
        </h2>
        <p className="max-w-[60ch] text-[14px] text-muted">
          Desativar esconde o anúncio sem apagar: a pessoa continua vendo o dela e pode reativar. A
          nota só aparece pra quem tem inscrição aprovada na edição.
        </p>
        {board.length === 0 ? (
          <p className="border-[1.5px] border-line px-5 py-6 font-mono text-xs text-muted">
            ninguém anunciou ainda nesta edição
          </p>
        ) : (
          <ul className="flex flex-col border-b border-line">
            {board.map((b) => (
              <li
                key={b.id}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-line py-2.5"
              >
                <span className="min-w-0 font-mono text-[12.5px] text-foreground [overflow-wrap:anywhere]">
                  @{b.username} · {b.need}
                  {b.hasTeam && <span className="ml-2 text-muted">(já tem time)</span>}
                  {!b.active && <span className="ml-2 text-muted">(inativo)</span>}
                </span>
                <TeamBoardToggle entryId={b.id} hackathonId={id} active={b.active} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
