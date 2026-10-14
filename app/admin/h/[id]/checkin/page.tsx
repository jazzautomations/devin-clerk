import { notFound } from "next/navigation";
import { CheckinDesk } from "@/components/CheckinDesk";
import { checkinCounts, formatCheckinTime, listCheckins } from "@/lib/checkins";
import { canManageEdition, hasEditionRole } from "@/lib/roles";
import { currentMember } from "@/lib/session";

// Check-in no dia (spec 033 US4): staff e organizador. Câmera do celular
// lê o QR do ingresso; sem câmera, busca manual. Contador ao vivo. Modo
// offline com pacote local + sync em lote, e walk-in da fila de espera.
export default async function EditionCheckinPage({ params }: PageProps<"/admin/h/[id]/checkin">) {
  const { id } = await params;
  const member = await currentMember();
  if (!member || !(await hasEditionRole(member, id, "staff"))) notFound();
  const [counts, recent, canManage] = await Promise.all([
    checkinCounts(id),
    listCheckins(id),
    canManageEdition(member, id),
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
      <CheckinDesk hackathonId={id} initialCounts={counts} canManage={canManage} />
      <div className="flex flex-col gap-3">
        <h3 className="font-mono text-[12px] tracking-widest text-muted uppercase">
          últimos check-ins
        </h3>
        {recentRows.length === 0 ? (
          <p className="font-mono text-[13px] text-muted">ninguém entrou ainda</p>
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
