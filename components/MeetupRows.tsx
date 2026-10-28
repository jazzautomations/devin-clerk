import Link from "next/link";
import { parseEventTime } from "@/lib/eventTime";
import { MEETUP_KIND_LABEL, isEmbedWindow, type MeetupListItem } from "@/lib/meetups";

// Linhas da agenda (página da comunidade e /comunidade/[slug]/agenda): o dia
// em bloco de tinta, tipo, título, quando, onde e quantos vão.

const fmtDiaNum = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", timeZone: "America/Sao_Paulo" });
const fmtMes = new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "America/Sao_Paulo" });
const fmtSemanaHora = new Intl.DateTimeFormat("pt-BR", {
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "America/Sao_Paulo",
});
const fmtAno = new Intl.DateTimeFormat("pt-BR", { year: "numeric", timeZone: "America/Sao_Paulo" });

function where(m: MeetupListItem): string {
  if (m.location) return m.location;
  if (m.embedUrl) return "live";
  return "online";
}

export function MeetupRows({
  items,
  now,
  testId,
  past = false,
}: {
  items: MeetupListItem[];
  now: Date;
  testId?: string;
  past?: boolean;
}) {
  const thisYear = fmtAno.format(now);
  return (
    <ul className="flex flex-col border-b border-line" data-testid={testId}>
      {items.map((m) => {
        const d = parseEventTime(m.startsAt)!;
        const live = !past && !m.cancelledAt && isEmbedWindow(m, now);
        const year = fmtAno.format(d);
        return (
          <li key={m.id} className="border-t border-line" data-testid="meetup-row" data-kind={m.kind}>
            <Link href={`/agenda/${m.id}`} className="group flex min-w-0 items-stretch gap-3 py-3 hover:bg-mint sm:gap-4">
              <span
                className={`flex w-[58px] shrink-0 flex-col items-center justify-center border-[1.5px] border-line py-1.5 ${
                  past || m.cancelledAt ? "bg-background text-muted" : "bg-foreground text-band"
                }`}
                aria-hidden
              >
                <span className="pix text-[28px] leading-none">{fmtDiaNum.format(d)}</span>
                <span className="font-mono text-[11px] tracking-[0.06em] uppercase">{fmtMes.format(d).replace(".", "")}</span>
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="chip bare">{MEETUP_KIND_LABEL[m.kind]}</span>
                  {live && <span className="chip bare border-accent! bg-mint! text-accent!">ao vivo</span>}
                  {m.cancelledAt && <span className="chip bare border-orange! text-orange!">cancelado</span>}
                </span>
                <span className={`text-[16.5px] leading-snug font-extrabold tracking-[-0.02em] break-words group-hover:underline ${m.cancelledAt ? "line-through decoration-1" : ""}`}>
                  {m.title}
                </span>
                <span className="font-mono text-[12.5px] break-words text-muted">
                  {fmtSemanaHora.format(d)}
                  {year !== thisYear ? ` · ${year}` : ""} · {where(m)}
                  {m.going > 0 && ` · ${m.going} ${m.going === 1 ? "vai" : "vão"}`}
                  {m.capacity != null && !past && ` · ${Math.max(m.capacity - m.going, 0)} de ${m.capacity} vagas`}
                </span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
