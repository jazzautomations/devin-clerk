import Link from "next/link";
import { nextDate, type Hackathon } from "@/lib/hackathons";

// spec 039 — lista de edições em linhas com fio (data pixel, nome, local,
// selo). Landing ("próximas edições") e /dashboard ("hackathons abertos").
const fmtDia = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", timeZone: "America/Sao_Paulo" });
const fmtMes = new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "America/Sao_Paulo" });
const FORMAT_LABEL: Record<string, string> = { online: "online", presencial: "presencial", hibrido: "híbrido" };

export function EditionRows({
  hackathons,
  registeredIds = [],
  testId,
  now = new Date(),
}: {
  hackathons: Hackathon[];
  registeredIds?: string[];
  testId?: string;
  now?: Date;
}) {
  return (
    <ul className="border-b-2 border-line" data-testid={testId}>
      {hackathons.map((h) => {
        // rolando: mostra até quando dá pra entrar, não o início que já passou
        const next = nextDate(h, now);
        const d = new Date(next.at);
        const mine = registeredIds.includes(h.id);
        return (
          <li key={h.id} className="border-t-2 border-line">
            <Link
              href={`/h/${h.id}`}
              className="group grid grid-cols-[60px_1fr] items-center gap-x-4 gap-y-2 py-4 hover:bg-mint sm:grid-cols-[84px_1fr_auto] sm:gap-x-6 sm:px-2"
            >
              <span className="pix row-span-2 bg-foreground py-1 text-center text-[21px] leading-[1.05] text-band sm:row-span-1 sm:text-[25px]">
                {next.ongoing && <span className="block text-[14px] leading-none text-background sm:text-[15px]">ATÉ</span>}
                {fmtDia.format(d)}
                <br />
                {fmtMes.format(d).replace(".", "").toUpperCase()}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[clamp(1.05rem,2.2vw,1.4rem)] leading-tight font-extrabold tracking-[-0.025em] group-hover:underline">
                  {h.name}
                </span>
                <span className="mt-1 block truncate font-mono text-[12.5px] text-muted">
                  {h.location ?? "online"} · {FORMAT_LABEL[h.format]} · {h.organizer}
                </span>
              </span>
              <span className="col-start-2 flex flex-wrap gap-1.5 sm:col-start-3 sm:justify-end">
                {mine && <span className="chip bare bg-foreground! text-band!">inscrito</span>}
                {h.partner ? (
                  <span className="chip bare border-accent! bg-mint! text-accent!">edição hack inova</span>
                ) : (
                  <span className="chip bare">radar</span>
                )}
                {h.prize && <span className="chip bare max-w-[180px] truncate">{h.prize}</span>}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
