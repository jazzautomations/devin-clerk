import Link from "next/link";
import { getEditionOverview } from "@/lib/editionOverview";

type Stat = { label: string; n: number; testId: string; note?: string };

export default async function EditionPanelHome({ params }: PageProps<"/admin/h/[id]">) {
  const { id } = await params;
  const o = await getEditionOverview(id);
  const intake: Stat[] = [
    { label: "inscrições", n: o.total, testId: "ov-total" },
    { label: "aprovados", n: o.approved, testId: "ov-approved" },
    { label: "pedidos pendentes", n: o.pending, testId: "ov-pending" },
  ];
  // funil do RSVP (migration 012) + fila de espera (FR-009)
  const funnel: Stat[] = [
    { label: "confirmados", n: o.confirmed, testId: "ov-confirmed" },
    { label: "recusados", n: o.declined, testId: "ov-declined" },
    {
      label: "sem resposta",
      n: o.noResponse,
      testId: "ov-noresponse",
      note: o.expired > 0 ? `+ ${o.expired} perderam o prazo` : undefined,
    },
    { label: "na fila", n: o.waitlist, testId: "ov-waitlist" },
    { label: "promovidos da fila", n: o.promoted, testId: "ov-promoted" },
  ];
  return (
    <div className="flex flex-col gap-6">
      <StatGrid stats={intake} cols="sm:grid-cols-3" />
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-mono text-[12px] tracking-widest text-muted uppercase">
            funil de presença{o.rsvpEnabled ? "" : " · RSVP desligado"}
          </h2>
          <span className="flex flex-wrap gap-x-4 font-mono text-[12px]">
            <Link href={`/admin/h/${id}/presenca`} className="text-accent underline-offset-4 hover:underline">
              presença →
            </Link>
            <Link href={`/admin/h/${id}/inscritos`} className="text-accent underline-offset-4 hover:underline">
              fila por posição →
            </Link>
          </span>
        </div>
        <StatGrid stats={funnel} cols="sm:grid-cols-5" />
        {o.rsvpEnabled && o.notInvited > 0 && (
          <p className="font-mono text-[12px] text-muted">
            {o.notInvited} aprovado{o.notInvited === 1 ? "" : "s"} ainda sem convite de confirmação
          </p>
        )}
      </section>
    </div>
  );
}

function StatGrid({ stats, cols }: { stats: Stat[]; cols: string }) {
  return (
    <dl className={`grid grid-cols-2 overflow-hidden border-[1.5px] border-line ${cols}`}>
      {stats.map((s) => (
        <div
          key={s.label}
          className="-mt-[1.5px] -ml-[1.5px] flex min-w-0 flex-col gap-1 border-t-[1.5px] border-l-[1.5px] border-line p-4 sm:p-5"
        >
          <dt className="font-mono text-[11px] tracking-widest text-muted uppercase sm:text-[12px]">{s.label}</dt>
          <dd className="pix text-4xl" data-testid={s.testId}>
            {s.n}
          </dd>
          {s.note && <dd className="font-mono text-[11px] text-muted">{s.note}</dd>}
        </div>
      ))}
    </dl>
  );
}
