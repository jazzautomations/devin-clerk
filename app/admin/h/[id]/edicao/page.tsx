import { notFound } from "next/navigation";
import db from "@/lib/db";
import { getPublishBlockers } from "@/lib/editionChecklist";
import { getHackathon } from "@/lib/hackathons";
import { getEditionCapacity } from "@/lib/registrations";
import { canManageEdition } from "@/lib/roles";
import { currentMember } from "@/lib/session";
import { CapacityForm } from "@/components/CapacityForm";
import { EditEventForm } from "@/components/EditEventForm";
import { PublishEditionButton } from "@/components/PublishEditionButton";

// Aba "configurar": datas, local, prazo, curadoria e vagas da edição, e o
// botão de publicar enquanto ela é rascunho. Organizador da edição (ou admin
// global). Arquivar e o link externo de inscrição ficam só com o admin.
export default async function EdicaoPage({ params }: PageProps<"/admin/h/[id]/edicao">) {
  const { id } = await params;
  const member = await currentMember();
  if (!member || !(await canManageEdition(member, id))) notFound();
  const [h, cap, blockers, items] = await Promise.all([
    getHackathon(id),
    getEditionCapacity(id),
    getPublishBlockers(id),
    db
      .prepare("SELECT COUNT(*)::int AS n FROM schedule_items WHERE hackathonId = ?")
      .get<{ n: number }>(id),
  ]);
  if (!h) notFound();
  const isAdmin = member.role === "admin";

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="text-[1.6rem] leading-none font-extrabold tracking-[-0.03em]">Configurar a edição</h2>
        <p className="text-[14px] text-muted">Datas e horários são sempre no horário de Brasília.</p>
        {!h.active && <PublishEditionButton hackathonId={id} blockers={blockers} />}
      </section>
      <EditEventForm
        isAdmin={isAdmin}
        event={{
          id: h.id,
          name: h.name,
          startsAt: h.startsAt,
          endsAt: h.endsAt,
          format: h.format,
          location: h.location,
          registrationUrl: h.registrationUrl,
          registrationDeadline: h.registrationDeadline,
          tags: h.tags,
          active: h.active,
          requiresApproval: h.requiresApproval,
          scheduleItems: Number(items?.n ?? 0),
        }}
      />
      <CapacityForm hackathonId={id} capacity={cap.capacity} approved={cap.approved} waitlist={cap.waitlist} />
    </div>
  );
}
