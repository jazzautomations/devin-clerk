import Link from "next/link";
import { notFound } from "next/navigation";
import { getHackathon } from "@/lib/hackathons";
import { effectiveCapacity, getEditionCapacity } from "@/lib/registrations";
import { canManageEdition } from "@/lib/roles";
import { currentMember } from "@/lib/session";
import { formatDbTime } from "@/lib/format";
import {
  formatDeadline,
  formatSp,
  getRsvpConfig,
  getRsvpFunnel,
  listRsvpRows,
  RSVP_STATE_LABEL,
  rsvpEmailReady,
  rsvpWindows,
  type RsvpRow,
} from "@/lib/rsvp";
import { RsvpConfigForm, RsvpResendButton } from "@/components/RsvpConfigForm";

// Aba presença (migration 012): configura a confirmação de presença, mostra
// o funil aprovados → confirmaram → aguardando → recusaram → expiraram →
// presentes (a definição única do funil; a visão geral só linka pra cá),
// reenvio individual e export. Só organizador/admin.

const STATE_CLASS: Record<RsvpRow["state"], string> = {
  nao_convidado: "border-line text-muted",
  pending: "border-line text-foreground",
  confirmed: "border-accent bg-mint text-accent",
  declined: "border-line text-muted",
  expired: "border-[#a8550a] text-[#a8550a]",
};

export default async function PresencaPage({ params }: PageProps<"/admin/h/[id]/presenca">) {
  const { id } = await params;
  const member = await currentMember();
  if (!(await canManageEdition(member, id))) notFound();
  const [h, config, funnel, rows, cap] = await Promise.all([
    getHackathon(id),
    getRsvpConfig(id),
    getRsvpFunnel(id),
    listRsvpRows(id),
    getEditionCapacity(id),
  ]);
  if (!h || !config) notFound();
  const emailReady = rsvpEmailReady();
  const effective = effectiveCapacity({
    capacity: cap.capacity,
    rsvpEnabled: config.enabled ? 1 : 0,
    overbookPercent: config.overbookPercent,
  });
  const over = effective !== null && cap.approved > effective ? cap.approved - effective : 0;
  const w = rsvpWindows(h.startsAt, config);
  const steps: { label: string; value: number; hint?: string }[] = [
    { label: "aprovados", value: funnel.approved },
    { label: "confirmaram", value: funnel.confirmed },
    { label: "aguardando", value: funnel.pending },
    { label: "recusaram", value: funnel.declined, hint: "vaga liberada" },
    { label: "expiraram", value: funnel.expired, hint: "sem resposta no prazo" },
    { label: "presentes", value: funnel.present, hint: "check-in feito" },
  ];
  const pct = (n: number) => (funnel.approved ? `${Math.round((n / funnel.approved) * 100)}%` : "—");

  return (
    <div className="flex flex-col gap-10">
      <section className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-[1.6rem] leading-none font-extrabold tracking-[-0.03em]">Confirmação de presença</h2>
          <p className="max-w-2xl text-[14px] text-muted">
            Evento grátis costuma ter metade de comparecimento. Com a confirmação, quem não vai devolve a vaga e a fila
            anda sozinha. Os lembretes da véspera e de 2 horas antes vão só pra quem confirmou.
          </p>
        </div>
        <p className="font-mono text-[13px]" data-testid="presenca-capacity">
          {cap.capacity === null ? "vagas sem limite" : `capacidade: ${cap.capacity} vagas`} · {cap.approved}{" "}
          {cap.approved === 1 ? "aprovado" : "aprovados"} ·{" "}
          <Link href={`/admin/h/${id}/edicao`} className="text-accent underline-offset-4 hover:underline">
            mudar vagas →
          </Link>
        </p>
        {over > 0 && (
          <p className="border-[1.5px] border-orange p-3 text-[14px]" data-testid="presenca-over">
            Há {cap.approved} aprovados para {effective} lugares ({over} a mais). Ninguém perde a vaga sozinho: confira
            se a sala comporta ou aumente as vagas.
          </p>
        )}
        {!emailReady && (
          <p className="border-[1.5px] border-line bg-chrome p-3 text-[14px]" data-testid="presenca-no-email">
            O e-mail da plataforma ainda não está configurado. Sem ele o convite não chega fora do site, então não dá
            pra ligar a confirmação de presença por enquanto.
          </p>
        )}
        <RsvpConfigForm hackathonId={id} initial={config} emailReady={emailReady} />
        {w ? (
          <ul className="grid gap-x-6 gap-y-1 font-mono text-[13px] sm:grid-cols-2" data-testid="rsvp-windows">
            <li>convite: {formatSp(w.opensAt)}</li>
            <li>prazo: {formatDeadline(w.deadlineAt)}</li>
            <li>lembrete D-1: {formatSp(w.d1At)}</li>
            <li>lembrete H-2: {formatSp(w.h2At)}</li>
          </ul>
        ) : (
          <p className="font-mono text-[13px] text-orange">data de início da edição inválida — sem janelas</p>
        )}
        <p className="font-mono text-[12px] text-muted">
          horários de Brasília · quem sai da fila depois do convite tem pelo menos 24h pra confirmar
        </p>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="border-t-2 border-line pt-5 text-[1.6rem] leading-none font-extrabold tracking-[-0.03em]">Funil</h2>
        <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" data-testid="rsvp-funnel">
          {steps.map((s) => (
            <li key={s.label} className="flex min-w-0 flex-col gap-1 border-[1.5px] border-line p-3">
              <span className="font-mono text-[11px] tracking-wider text-muted uppercase">{s.label}</span>
              <span className="text-[1.8rem] leading-none font-extrabold tracking-[-0.03em]">{s.value}</span>
              <span className="font-mono text-[11px] text-muted">
                {s.label === "aprovados" ? `${funnel.notInvited} sem convite ainda` : `${pct(s.value)}${s.hint ? ` · ${s.hint}` : ""}`}
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3 border-t-2 border-line pt-5">
          <h2 className="text-[1.6rem] leading-none font-extrabold tracking-[-0.03em]">Pessoas</h2>
          <a href={`/api/admin/hackathons/${id}/rsvp?format=csv`} className="btn rounded-[6px]">
            baixar planilha ↓
          </a>
        </div>
        {rows.length === 0 ? (
          <p className="border-[1.5px] border-dashed border-line p-5 font-mono text-[13px] text-muted">
            ninguém aprovado ainda. Aprove inscrições na aba{" "}
            <Link href={`/admin/h/${id}/inscritos`} className="text-accent underline underline-offset-4">
              inscritos
            </Link>
            .
          </p>
        ) : (
          <ul className="border-b border-line">
            {rows.map((r, i) => (
              <li
                key={`${r.memberId}-${r.state}-${i}`}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-line py-3"
              >
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className={`shrink-0 border px-1.5 font-mono text-[11px] uppercase ${STATE_CLASS[r.state]}`}>
                    {RSVP_STATE_LABEL[r.state]}
                  </span>
                  <span className="truncate font-semibold">{r.name ?? r.username}</span>
                  <span className="hidden truncate font-mono text-[12px] text-muted sm:inline">@{r.username}</span>
                </span>
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[12px] text-muted">
                  {r.state === "pending" && r.deadlineAt && <span>prazo {formatDeadline(new Date(`${r.deadlineAt.replace(" ", "T")}Z`))}</span>}
                  {r.respondedAt && r.state !== "pending" && <span>{formatDbTime(r.respondedAt)}</span>}
                  {r.checkedInAt && <span className="text-accent">presente</span>}
                  {(r.state === "pending" || r.state === "confirmed") && !r.checkedInAt && (
                    <RsvpResendButton hackathonId={id} memberId={r.memberId} />
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
