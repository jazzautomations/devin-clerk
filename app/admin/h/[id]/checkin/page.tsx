import { notFound } from "next/navigation";
import { CheckinDesk } from "@/components/CheckinDesk";
import { checkinCounts, editionCheckinWindow, formatCheckinTime, listCheckins } from "@/lib/checkins";
import { canManageEdition, hasEditionRole } from "@/lib/roles";
import { formatSp } from "@/lib/rsvp";
import { currentMember } from "@/lib/session";

// Check-in no dia (spec 033 US4): staff e organizador. Câmera do celular
// lê o QR do ingresso; sem câmera, busca manual. Contador ao vivo. Modo
// offline com pacote local + sync em lote, e entrada de quem está na fila de
// espera. Fora da janela do evento (véspera até 2 dias depois do fim) o
// servidor recusa o check-in; a página avisa antes.
export default async function EditionCheckinPage({ params }: PageProps<"/admin/h/[id]/checkin">) {
  const { id } = await params;
  const member = await currentMember();
  if (!member || !(await hasEditionRole(member, id, "staff"))) notFound();
  const [counts, recent, canManage, win] = await Promise.all([
    checkinCounts(id),
    listCheckins(id),
    canManageEdition(member, id),
    editionCheckinWindow(id),
  ]);
  const recentRows = recent.slice(0, 10).map((r) => ({
    key: r.registrationId,
    label: r.name ?? `@${r.username}`,
    username: r.username,
    hhmm: formatCheckinTime(r.at),
  }));
  return (
    <section className="flex flex-col gap-6">
      <h2 className="text-[clamp(1.4rem,3vw,1.8rem)] leading-none font-extrabold tracking-[-0.03em]">
        Check-in
      </h2>
      {win && !win.inside && (
        <p className="border-[1.5px] border-line bg-chrome p-3 text-[14px]" data-testid="checkin-window-note">
          O check-in abre na véspera ({formatSp(win.window.start)}) e fecha 2 dias depois do fim (
          {formatSp(win.window.end)}). Fora desse horário a presença não é registrada.
        </p>
      )}
      <CheckinDesk hackathonId={id} initialCounts={counts} canManage={canManage} />
      <div className="flex flex-col gap-3">
        <h3 className="font-mono text-[12px] tracking-widest text-muted uppercase">
          últimos check-ins
        </h3>
        {recentRows.length === 0 ? (
          <p className="font-mono text-[13px] text-muted">
            ninguém fez check-in ainda. Leia o QR do ingresso com a câmera ou busque a pessoa pelo nome.
          </p>
        ) : (
          <ul className="border-b border-line">
            {recentRows.map((r) => (
              <li key={r.key} className="flex items-baseline justify-between gap-4 border-t border-line py-2.5">
                <span className="min-w-0 truncate font-semibold">{r.label}</span>
                <span className="shrink-0 font-mono text-[13px] text-muted">{r.hhmm}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
