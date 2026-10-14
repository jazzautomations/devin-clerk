import Link from "next/link";
import {
  displayAnswer,
  type EditionQuestion,
  type RegistrantWithAnswers,
} from "@/lib/registrationForm";
import { summaryText, type AttendanceSummary } from "@/lib/rsvp";

const STATUS_LABEL: Record<string, string> = {
  approved: "aprovado",
  pending: "pendente",
  waitlist: "fila",
  rejected: "recusado",
};
const STATUS_CLASS: Record<string, string> = {
  approved: "border-accent bg-mint text-accent",
  pending: "border-line text-foreground",
  waitlist: "border-[#a8550a] text-[#a8550a]",
  rejected: "border-line text-muted",
};

// lista de inscritos com respostas e aceite — server component puro (sem
// busca de dado), a página da aba faz a guarda e carrega
export function RegistrantsTable({
  hackathonId: id,
  questions,
  rows,
  attendance = {},
}: {
  hackathonId: string;
  questions: EditionQuestion[];
  rows: RegistrantWithAnswers[];
  /** histórico de presença em outras edições (lib/rsvp) — só informa */
  attendance?: Record<number, AttendanceSummary>;
}) {
  const count = (s: string) => rows.filter((r) => r.status === s).length;
  const fmt = (d: string | null) =>
    d
      ? new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(
          new Date(d.replace(" ", "T") + "Z"),
        )
      : "—";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <p className="font-mono text-[13px] text-muted">
          {rows.length} {rows.length === 1 ? "inscrição" : "inscrições"} · {count("approved")} aprovados ·{" "}
          {count("pending")} pendentes · {count("waitlist")} na fila ·{" "}
          <span data-testid="no-photo-count">{rows.filter((r) => !r.imageConsent).length} sem uso de imagem</span>
        </p>
        <a href={`/api/admin/hackathons/${id}/registrations?format=csv`} className="btn rounded-[6px]">
          exportar csv ↓
        </a>
      </div>
      {rows.length === 0 ? (
        <p className="border-[1.5px] border-dashed border-line p-5 font-mono text-[13px] text-muted">
          ninguém inscrito ainda.{" "}
          <Link href={`/admin/h/${id}/formulario`} className="text-accent underline">
            montar o formulário
          </Link>
        </p>
      ) : (
        <ul className="border-b border-line">
          {rows.map((r) => (
            <li key={r.memberId} className="border-t border-line">
              <details className="group">
                <summary className="flex cursor-pointer list-none flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className={`shrink-0 border px-1.5 font-mono text-[11px] uppercase ${STATUS_CLASS[r.status]}`}>
                      {STATUS_LABEL[r.status]}
                      {r.waitlistPosition !== null && ` #${r.waitlistPosition}`}
                    </span>
                    <span className="truncate font-semibold">{r.name ?? r.username}</span>
                    {!r.imageConsent && (
                      <span
                        className="shrink-0 border border-orange px-1.5 font-mono text-[11px] text-orange uppercase"
                        title="não autorizou uso de imagem"
                        data-testid="no-photo"
                      >
                        sem foto
                      </span>
                    )}
                    {r.ageAtEvent !== null && r.ageAtEvent < 18 && (
                      <span className="shrink-0 border border-line px-1.5 font-mono text-[11px] uppercase">
                        menor · {r.ageAtEvent}
                      </span>
                    )}
                    <span className="hidden truncate font-mono text-[12px] text-muted sm:inline">@{r.username}</span>
                  </span>
                  <span className="font-mono text-[12px] text-muted">
                    {fmt(r.createdAt)} <span className="text-accent group-open:hidden">+</span>
                    <span className="hidden text-accent group-open:inline">−</span>
                  </span>
                </summary>
                <div className="flex flex-col gap-3 pb-4 pl-1 text-[14px]">
                  <p className="font-mono text-[12px] break-all text-muted">
                    {r.email}
                    {r.github && ` · github ${r.github}`}
                  </p>
                  <p className="font-mono text-[12px]" data-testid="attendance-summary">
                    <span className="text-muted">presença em outras edições:</span> {summaryText(attendance[r.memberId])}
                    <span className="text-muted"> — só informativo; a pessoa vê o mesmo no painel dela e pode contestar</span>
                  </p>
                  <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
                    {questions
                      .filter((q) => r.answers[q.id] || !q.archived)
                      .map((q) => {
                        const a = r.answers[q.id];
                        return (
                          <div key={q.id} className="contents">
                            <dt className="text-muted">
                              {a?.label ?? q.label}
                              {a && a.questionVersion !== q.version && (
                                <span className="ml-1 font-mono text-[11px]">(v{a.questionVersion})</span>
                              )}
                            </dt>
                            <dd className="break-words font-semibold">{a ? displayAnswer(a.value) : "—"}</dd>
                          </div>
                        );
                      })}
                  </dl>
                  <p className="font-mono text-[12px] text-muted">
                    {r.consentVersion
                      ? `aceite dos termos v${r.consentVersion} em ${fmt(r.consentAt)}`
                      : "sem aceite registrado (inscrição anterior ao formulário)"}
                    {r.promotedAt && ` · saiu da fila em ${fmt(r.promotedAt)}`}
                  </p>
                  <p className="font-mono text-[12px] text-muted">
                    {r.ageAtEvent !== null
                      ? `${r.ageAtEvent} anos no evento · código de conduta v${r.conductVersion}`
                      : "sem data de nascimento/código de conduta (inscrição anterior aos termos)"}
                    {r.guardianName && ` · responsável: ${r.guardianName}`}
                    {` · uso de imagem: ${r.imageConsent ? "autorizado" : "não autorizado"}`}
                  </p>
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
