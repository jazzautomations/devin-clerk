import { notFound } from "next/navigation";
import { getHackathon } from "@/lib/hackathons";
import { currentMember } from "@/lib/session";
import { canManageEdition } from "@/lib/roles";
import {
  AUDIENCE_LABEL,
  KIND_LABEL,
  SCHEDULE_AUDIENCES,
  SCHEDULE_KINDS,
  editionWindow,
  listScheduleItems,
  toEditorItem,
  utcToSp,
  toDbText,
} from "@/lib/schedule";
import { ScheduleEditor } from "@/components/ScheduleEditor";

// Aba de programação do painel da edição (organizador/admin).
export default async function ProgramacaoAdminPage({ params }: PageProps<"/admin/h/[id]/programacao">) {
  const { id } = await params;
  const member = await currentMember();
  if (!(await canManageEdition(member, id))) notFound();
  const h = await getHackathon(id);
  if (!h) notFound();
  const items = await listScheduleItems(id, { includeDrafts: true });
  const win = editionWindow(h);
  const startMs = new Date(h.startsAt).getTime();
  const start = utcToSp(toDbText(Number.isNaN(startMs) ? new Date() : new Date(startMs)));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-[1.6rem] leading-none font-extrabold tracking-[-0.03em]">Programação</h2>
        <p className="text-[14px] text-muted">
          Item novo nasce rascunho. Publicado aparece em /h/{id}/programacao e nos calendários assinados. Mudar horário
          ou sala de item publicado avisa sozinho quem é do público do item.
        </p>
      </div>
      <ScheduleEditor
        hackathonId={id}
        initialItems={items.map(toEditorItem)}
        defaultDate={start.date}
        window={
          win
            ? { from: utcToSp(toDbText(win.from)).date, to: utcToSp(toDbText(win.to)).date }
            : null
        }
        audiences={SCHEDULE_AUDIENCES.map((v) => ({ value: v, label: AUDIENCE_LABEL[v] }))}
        kinds={SCHEDULE_KINDS.map((v) => ({ value: v, label: KIND_LABEL[v] }))}
      />
    </div>
  );
}
