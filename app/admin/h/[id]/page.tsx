import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getEditionChecklist, PHASE_LABEL } from "@/lib/editionChecklist";
import { getEditionOverview } from "@/lib/editionOverview";
import { mySponsorships } from "@/lib/editionSponsors";
import { getHackathon } from "@/lib/hackathons";
import { canManageEdition, getEditionRoles } from "@/lib/roles";
import { formatSp, parseEventStart } from "@/lib/rsvp";
import { currentMember } from "@/lib/session";
import { PublishEditionButton } from "@/components/PublishEditionButton";

type Stat = { label: string; n: number; testId: string; href?: string };

// Visão geral do painel: em que fase a edição está, o que falta pra essa
// fase (cada item leva pra aba que resolve) e os números da inscrição. O
// funil de confirmação de presença mora na aba presença; aqui só o resumo.
export default async function EditionPanelHome({ params, searchParams }: PageProps<"/admin/h/[id]">) {
  const { id } = await params;
  const novo = (await searchParams).novo === "1";
  // quem só é de patrocinador (migration 017) não vê a visão geral da
  // operação: vai direto pro relatório da própria marca
  const member = await currentMember();
  if (!member) notFound();
  if (member.role !== "admin" && (await getEditionRoles(id, member.id)).length === 0) {
    const mine = await mySponsorships(id, member.id);
    if (mine.length === 0) notFound();
    redirect(`/admin/h/${id}/patrocinador/${mine[0].sponsorId}`);
  }
  const [o, h, manage, checklist] = await Promise.all([
    getEditionOverview(id),
    getHackathon(id),
    canManageEdition(member, id),
    getEditionChecklist(id),
  ]);
  if (!h || !checklist) notFound();
  const start = parseEventStart(h.startsAt);
  const end = parseEventStart(h.endsAt);
  const when = start ? `${formatSp(start)}${end ? ` até ${formatSp(end)}` : ""}` : "data de início inválida";
  const done = checklist.items.filter((i) => i.done).length;

  const intake: Stat[] = [
    { label: "inscrições", n: o.total, testId: "ov-total" },
    { label: "aprovados", n: o.approved, testId: "ov-approved" },
    {
      label: "pedidos pendentes",
      n: o.pending,
      testId: "ov-pending",
      href: manage && o.pending > 0 ? `/admin/h/${id}/inscritos?status=pending` : undefined,
    },
    { label: "na fila de espera", n: o.waitlist, testId: "ov-waitlist" },
  ];

  return (
    <div className="flex flex-col gap-8">
      {novo && manage && checklist.phase === "rascunho" && (
        <p className="border-2 border-line bg-mint px-4 py-3 text-[15px]" data-testid="ov-novo">
          <b>Rascunho criado.</b> Só a equipe vê por enquanto. Siga os próximos passos e publique
          {h.communityName ? `: quem está na ${h.communityName} recebe o aviso.` : "."}
        </p>
      )}
      <section className="flex flex-col gap-2 border-[1.5px] border-line p-4 sm:p-5" data-testid="ov-status">
        <p className="font-mono text-[12px] tracking-widest text-muted uppercase">fase</p>
        <p className="text-[1.3rem] leading-tight font-extrabold tracking-[-0.02em]" data-testid="ov-phase">
          {PHASE_LABEL[checklist.phase]}
        </p>
        <p className="font-mono text-[13px] text-muted">
          {when} · horário de Brasília
          {h.location ? ` · ${h.location}` : ""}
          {` · ${checklist.capacity === null ? "vagas sem limite" : `${checklist.capacity} vagas`}`}
        </p>
        {manage && checklist.phase === "rascunho" && (
          <div className="pt-2">
            <PublishEditionButton hackathonId={id} blockers={checklist.blockers} />
          </div>
        )}
      </section>

      {manage && (
        <section className="flex flex-col gap-3" data-testid="ov-checklist">
          <h2 className="font-mono text-[12px] tracking-widest text-muted uppercase">
            próximos passos · {done} de {checklist.items.length} feitos
          </h2>
          <ul className="border-b border-line">
            {checklist.items.map((i) => (
              <li key={i.key} className="border-t border-line">
                <Link
                  href={i.href}
                  className="flex min-h-11 items-center gap-3 py-2 hover:text-accent"
                  data-done={i.done ? "1" : "0"}
                >
                  <span
                    aria-hidden
                    className={`inline-flex size-5 shrink-0 items-center justify-center border-[1.5px] font-mono text-[12px] ${
                      i.done ? "border-accent bg-mint text-accent" : "border-line"
                    }`}
                  >
                    {i.done ? "✓" : ""}
                  </span>
                  <span className={i.done ? "text-muted line-through decoration-1" : "font-semibold"}>{i.label}</span>
                  <span className="sr-only">{i.done ? "(feito)" : "(falta)"}</span>
                  {i.optional && !i.done && <span className="font-mono text-[12px] text-muted">opcional</span>}
                  <span aria-hidden className="ml-auto font-mono text-[13px] text-accent">
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="font-mono text-[12px] tracking-widest text-muted uppercase">inscrição</h2>
        <StatGrid stats={intake} />
        {manage && (
          <p className="font-mono text-[13px]">
            <Link href={`/admin/h/${id}/presenca`} className="text-accent underline-offset-4 hover:underline">
              confirmação de presença{o.rsvpEnabled ? `: ${o.confirmed} de ${o.approved} confirmaram` : " desligada"} →
            </Link>
          </p>
        )}
      </section>
    </div>
  );
}

function StatGrid({ stats }: { stats: Stat[] }) {
  return (
    <dl className="grid grid-cols-2 overflow-hidden border-[1.5px] border-line sm:grid-cols-4">
      {stats.map((s) => (
        <div
          key={s.label}
          className="-mt-[1.5px] -ml-[1.5px] flex min-w-0 flex-col gap-1 border-t-[1.5px] border-l-[1.5px] border-line p-4 sm:p-5"
        >
          <dt className="font-mono text-[11px] tracking-widest text-muted uppercase sm:text-[12px]">{s.label}</dt>
          <dd className="text-[1.8rem] leading-none font-extrabold tracking-[-0.03em]" data-testid={s.testId}>
            {s.href ? (
              <Link href={s.href} className="text-accent underline-offset-4 hover:underline">
                {s.n}
                <span className="sr-only"> pedidos pendentes, ver na aba inscritos</span>
              </Link>
            ) : (
              s.n
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
