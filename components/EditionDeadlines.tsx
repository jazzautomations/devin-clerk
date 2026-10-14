import Link from "next/link";
import {
  formatBrt,
  getSubmissionSettings,
  lockAt,
  myEntry,
  parseDbTime,
  STATUS_LABEL,
  toDbTime,
} from "@/lib/entries";
import { getEditionEntriesView } from "@/lib/entriesPublic";

// spec 034 — bloco "prazos" da página da edição: linha do tempo no horário
// de Brasília, quantos times entregaram e o atalho pra entrega do meu time.
// Some quando a edição não tem prazo nenhum configurado.

type Step = { key: string; label: string; at: string | null; note?: string };

export async function EditionDeadlines({
  hackathonId,
  username,
}: {
  hackathonId: string;
  username: string | null;
}) {
  const s = await getSubmissionSettings(hackathonId);
  if (!s) return null;
  const steps: Step[] = [
    { key: "times", label: "formação de times", at: s.teamFormationDeadline },
    { key: "abre", label: "entrega abre", at: s.submissionOpensAt },
    {
      key: "prazo",
      label: "prazo de entrega",
      at: s.submissionDeadline,
      note: s.submissionGraceMinutes > 0 ? `tolerância de ${s.submissionGraceMinutes} min` : undefined,
    },
    { key: "juri", label: "júri termina", at: s.juryDeadline },
  ].filter((x) => x.at);
  if (steps.length === 0) return null;

  const now = new Date().getTime();
  const [view, mine] = await Promise.all([
    getEditionEntriesView(hackathonId),
    username ? myEntry(hackathonId, username) : Promise.resolve(null),
  ]);
  const lock = lockAt(s);
  const lockText = lock ? formatBrt(toDbTime(lock)) : null;

  return (
    <section data-testid="edition-deadlines" className="flex flex-col gap-4 border-[1.5px] border-line p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-mono text-[12px] tracking-[0.06em] text-muted uppercase">prazos · horário de Brasília</h2>
        <Link href={`/h/${hackathonId}/projetos`} className="font-mono text-[12px] text-accent hover:underline">
          {view.counts.teams} {view.counts.teams === 1 ? "time" : "times"} · {view.counts.submitted}{" "}
          {view.counts.submitted === 1 ? "entregue" : "entregues"} · ver projetos →
        </Link>
      </div>
      <ol className="flex flex-col">
        {steps.map((st) => {
          const done = (parseDbTime(st.at)?.getTime() ?? 0) < now;
          return (
            <li
              key={st.key}
              className="grid grid-cols-[1fr_auto] items-baseline gap-3 border-t border-line py-2.5 first:border-t-0"
            >
              <span className={`text-[15px] ${done ? "text-muted line-through" : "font-semibold"}`}>
                {st.label}
                {st.note && <span className="ml-2 font-mono text-[11px] text-muted no-underline">{st.note}</span>}
              </span>
              <span className={`font-mono text-[13px] tabular-nums ${done ? "text-muted" : "text-accent"}`}>
                {formatBrt(st.at)}
              </span>
            </li>
          );
        })}
      </ol>
      {mine && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t-[1.5px] border-line pt-3">
          <p className="text-[14px]">
            Entrega do <strong>{mine.teamName}</strong>:{" "}
            <span className={mine.status === "rascunho" || mine.status === "nao_entregue" ? "text-orange" : "text-accent"}>
              {STATUS_LABEL[mine.status]}
            </span>
            {mine.status === "rascunho" && lockText && (
              <span className="text-muted"> — envia até {lockText}</span>
            )}
          </p>
          <Link href={`/h/${hackathonId}/entrega`} className="btn">
            {mine.locked ? "ver entrega" : "abrir entrega"}
          </Link>
        </div>
      )}
    </section>
  );
}
