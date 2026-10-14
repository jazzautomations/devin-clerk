import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NpsCloseForm } from "@/components/NpsCloseForm";
import { NpsPanelView } from "@/components/NpsPanelView";
import { dbToBrtInput, formatBrt, toDbTime } from "@/lib/entries";
import { getNpsSummary, getNpsWindow, npsPhase, NPS_DEFAULT_DAYS } from "@/lib/nps";
import { canManageEdition } from "@/lib/roles";
import { currentMember } from "@/lib/session";

export const metadata: Metadata = { title: "NPS da edição", robots: { index: false } };

const PHASE_TEXT = {
  antes: "abre quando a edição terminar",
  aberta: "aberta",
  encerrada: "encerrada",
} as const;

// NPS por papel (roadmap 037 #11) — só organizador. Anônimo: a página nunca
// recebe quem respondeu, só o agregado e os comentários sem autor.
export default async function NpsPage({ params }: PageProps<"/admin/h/[id]/nps">) {
  const { id } = await params;
  const member = await currentMember();
  if (!member || !(await canManageEdition(member, id))) notFound();
  const [w, summary] = await Promise.all([getNpsWindow(id), getNpsSummary(id)]);
  if (!w) notFound();
  const phase = npsPhase(w);
  const opens = w.opensAt ? formatBrt(toDbTime(w.opensAt)) : "—";
  const closes = w.closesAt ? formatBrt(toDbTime(w.closesAt)) : "—";

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-[clamp(1.4rem,3vw,1.8rem)] leading-none font-extrabold tracking-[-0.03em]">NPS</h2>
        <p className="max-w-[62ch] text-[14px] text-muted">
          Quando a edição termina, quem fez check-in e quem teve papel (staff, mentor, jurado, patrocinador) recebe a
          pesquisa por aviso e e-mail. Uma resposta por pessoa, editável até o prazo. Você vê só o agregado e os
          comentários, sem nome nem data.
        </p>
        <p className="font-mono text-[13px]" data-testid="nps-window">
          pesquisa {PHASE_TEXT[phase]} · abre {opens} · fecha {closes}
          {w.custom ? "" : ` (padrão: fim + ${NPS_DEFAULT_DAYS} dias)`}
        </p>
      </div>
      <NpsCloseForm hackathonId={id} value={w.custom && w.closesAt ? dbToBrtInput(toDbTime(w.closesAt)) : ""} />
      <NpsPanelView summary={summary} />
    </section>
  );
}
