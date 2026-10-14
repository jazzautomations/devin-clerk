import Link from "next/link";
import { ATTENDANCE_LABEL, type AttendanceEntry, type AttendanceSummary } from "@/lib/rsvp";

// histórico de comparecimento do próprio membro (/dashboard) + convites de
// RSVP esperando resposta. Server component puro: a página carrega.
// Transparência (LGPD art. 20): é exatamente o que a curadoria vê, e não
// decide nada sozinho.
export function AttendanceHistory({
  entries,
  summary,
  pending,
}: {
  entries: AttendanceEntry[];
  summary: AttendanceSummary;
  pending: { hackathonId: string; hackathonName: string; deadline: string; href: string }[];
}) {
  if (entries.length === 0 && pending.length === 0) return null;
  return (
    <div className="flex flex-col gap-3" data-testid="attendance-history">
      {pending.length > 0 && (
        <ul className="flex flex-col gap-2">
          {pending.map((p) => (
            <li
              key={p.hackathonId}
              className="flex flex-wrap items-center justify-between gap-3 border-[1.5px] border-accent bg-mint px-4 py-3"
            >
              <span className="min-w-0">
                <strong className="font-display tracking-[-0.02em]">{p.hackathonName}</strong>{" "}
                <span className="font-mono text-[12px] text-muted">· confirme até {p.deadline}</span>
              </span>
              <Link href={p.href} className="btn rounded-[6px]">
                confirmar presença
              </Link>
            </li>
          ))}
        </ul>
      )}
      {entries.length > 0 && (
        <>
          <h2 className="font-mono text-xs tracking-[0.06em] text-muted uppercase">teu histórico de presença</h2>
          <p className="font-mono text-[13px]">
            {summary.compareceu} compareceu · {summary.faltou} faltou
            {summary.sem_resposta ? ` · ${summary.sem_resposta} sem resposta` : ""} · {summary.recusou} liberou vaga ·{" "}
            {summary.expirou} não confirmou a tempo
          </p>
          <ul className="divide-y divide-line border-y border-line">
            {entries.map((e) => (
              <li key={`${e.hackathonId}-${e.outcome}`} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
                <Link href={`/h/${e.hackathonId}`} className="min-w-0 truncate transition hover:text-accent">
                  {e.hackathonName}
                </Link>
                <span className={`font-mono text-xs ${e.outcome === "compareceu" ? "text-accent" : "text-muted"}`}>
                  {ATTENDANCE_LABEL[e.outcome]}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-[13px] text-muted">
            A organização vê este mesmo resumo ao analisar inscrições. Ele só informa — nenhuma vaga é negada
            automaticamente por ele. Faltou check-in mas você foi? Fale com a organização da edição pra corrigir.
          </p>
        </>
      )}
    </div>
  );
}
