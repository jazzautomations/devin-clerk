import Link from "next/link";
import { notFound } from "next/navigation";
import { canManageEdition } from "@/lib/roles";
import { currentMember } from "@/lib/session";
import {
  INCIDENT_KIND_LABEL,
  INCIDENT_STATUS_LABEL,
  canHandleIncidents,
  listHandlerCandidates,
  listIncidents,
} from "@/lib/incidents";
import { ConductHandlerToggle, IncidentEditor } from "@/components/IncidentAdmin";

const fmt = (d: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(d.replace(" ", "T") + "Z"));

const STATUS_CLASS: Record<string, string> = {
  aberto: "border-orange text-orange",
  em_andamento: "border-line text-foreground",
  resolvido: "border-accent bg-mint text-accent",
};

// Incidentes de conduta (roadmap 037 #7). SÓ organizador/admin e quem o
// organizador marcou como responsável de conduta — staff comum não vê.
export default async function IncidentesPage({ params }: PageProps<"/admin/h/[id]/incidentes">) {
  const { id } = await params;
  const member = await currentMember();
  if (!member || !(await canHandleIncidents(member, id))) notFound();
  const organizer = await canManageEdition(member, id);
  const [incidents, candidates] = await Promise.all([
    listIncidents(id),
    organizer ? listHandlerCandidates(id) : Promise.resolve([]),
  ]);
  const open = incidents.filter((i) => i.status !== "resolvido").length;

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-[clamp(1.4rem,3vw,1.8rem)] leading-none font-extrabold tracking-[-0.03em]">
          Incidentes
        </h2>
        <span className="flex flex-wrap gap-4 font-mono text-[13px]">
          <Link href={`/h/${id}/conduta`} className="text-accent underline-offset-4 hover:underline">
            código de conduta ↗
          </Link>
          <Link href={`/h/${id}/incidente`} className="text-accent underline-offset-4 hover:underline">
            canal público ↗
          </Link>
        </span>
      </div>
      <p className="max-w-2xl text-[14px] text-muted">
        {incidents.length} {incidents.length === 1 ? "relato" : "relatos"} · {open} em aberto. Relato anônimo não guarda
        nome nem IP. Trate com sigilo: responda em até 24h e registre o que foi feito na nota interna.
      </p>

      {incidents.length === 0 ? (
        <p className="border-[1.5px] border-dashed border-line p-5 font-mono text-[13px] text-muted" data-testid="no-incidents">
          nenhum relato nesta edição.
        </p>
      ) : (
        <ul className="border-b border-line" data-testid="incident-list">
          {incidents.map((i) => (
            <li key={i.id} className="border-t border-line">
              <details className="group" open={i.status === "aberto"}>
                <summary className="flex cursor-pointer list-none flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className={`shrink-0 border px-1.5 font-mono text-[11px] uppercase ${STATUS_CLASS[i.status]}`}>
                      {INCIDENT_STATUS_LABEL[i.status]}
                    </span>
                    <span className="truncate font-semibold">{INCIDENT_KIND_LABEL[i.kind]}</span>
                  </span>
                  <span className="font-mono text-[12px] text-muted">
                    #{i.id} · {fmt(i.createdAt)}
                  </span>
                </summary>
                <div className="flex flex-col gap-3 pb-4 text-[14px]">
                  <p className="whitespace-pre-wrap break-words">{i.description}</p>
                  <dl className="grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 gap-y-1 font-mono text-[12px]">
                    <dt className="text-muted">onde</dt>
                    <dd className="break-words">{i.location ?? "—"}</dd>
                    <dt className="text-muted">quando</dt>
                    <dd className="break-words">{i.occurredAt ?? "—"}</dd>
                    <dt className="text-muted">quem</dt>
                    <dd className="break-words">{i.anonymous ? "anônimo" : `@${i.reporterUsername}`}</dd>
                    <dt className="text-muted">contato</dt>
                    <dd className="break-words">{i.contact ?? "—"}</dd>
                    {i.updatedByUsername && (
                      <>
                        <dt className="text-muted">última ação</dt>
                        <dd className="break-words">
                          @{i.updatedByUsername} · {fmt(i.updatedAt)}
                        </dd>
                      </>
                    )}
                  </dl>
                  <IncidentEditor hackathonId={id} incidentId={i.id} status={i.status} note={i.internalNote} />
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}

      {organizer && (
        <div className="flex flex-col gap-2 border-[1.5px] border-line p-4 sm:p-5" data-testid="conduct-handlers">
          <h3 className="text-[17px] font-bold">Responsáveis de conduta</h3>
          <p className="text-[14px] text-muted">
            Por padrão só a organização vê esta aba. Marque quem da equipe também pode ler e tratar os relatos (recebe
            a notificação de relato novo).
          </p>
          {candidates.length === 0 ? (
            <p className="font-mono text-[13px] text-muted">
              ninguém na equipe além da organização.{" "}
              <Link href={`/admin/h/${id}/equipe`} className="text-accent underline">
                convidar equipe
              </Link>
            </p>
          ) : (
            <div className="flex flex-col">
              {candidates.map((c) => (
                <ConductHandlerToggle
                  key={c.memberId}
                  hackathonId={id}
                  memberId={c.memberId}
                  on={c.handler}
                  label={`${c.name ?? `@${c.username}`} · ${c.roles}`}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
