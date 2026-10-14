import { notFound } from "next/navigation";
import { StageControl } from "@/components/StageControl";
import { hasEditionRole } from "@/lib/roles";
import { currentMember } from "@/lib/session";
import { getStageAdmin } from "@/lib/stage";

// Modo palco — controle da final, do celular do organizador/staff: fila
// dos pitches, próximo/anterior, cronômetro, votação e encerramento.
export default async function EditionStagePage({ params }: PageProps<"/admin/h/[id]/palco">) {
  const { id } = await params;
  const member = await currentMember();
  if (!member || !(await hasEditionRole(member, id, "staff"))) notFound();
  const state = await getStageAdmin(id);
  return (
    <section className="flex flex-col gap-6">
      <h2 className="text-[clamp(1.4rem,3vw,1.8rem)] leading-none font-extrabold tracking-[-0.03em]">
        Palco — final ao vivo
      </h2>
      <StageControl hackathonId={id} initial={state} />
    </section>
  );
}
