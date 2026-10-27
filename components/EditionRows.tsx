import Link from "next/link";
import { nextDate, type Hackathon } from "@/lib/hackathons";
import { closingLabel, compactPrize, isBrasil, radarBadges, shortLocation } from "@/lib/radar";

// spec 039 — lista de edições em linhas com fio (data pixel, nome, local,
// selo). Landing ("abertos agora", Brasil + globais) e /dashboard
// ("hackathons abertos", só Brasil).
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
        // prêmio curto na moeda original ("US$ 50 mil"); o global da
        // amostra da landing ganha o selo de alcance e de quem pode entrar
        const prize = compactPrize(h.prize);
        const global = !isBrasil(h) ? radarBadges(h, now) : null;
        const closing = closingLabel(h, now);
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
                <span className="line-clamp-2 block text-[clamp(1.05rem,2.2vw,1.4rem)] leading-tight font-extrabold tracking-[-0.025em] [overflow-wrap:anywhere] group-hover:underline">
                  {h.name}
                </span>
                <span className="mt-1 block truncate font-mono text-[12.5px] text-muted">
                  {[shortLocation(h.location), FORMAT_LABEL[h.format] ?? "online", h.organizer].filter(Boolean).join(" · ")}
                </span>
              </span>
              <span className="col-start-2 flex flex-wrap gap-1.5 sm:col-start-3 sm:justify-end">
                {mine && <span className="chip bare bg-foreground! text-band!">inscrito</span>}
                {h.hosted ? (
                  <span className="chip bare border-accent! bg-mint! text-accent!">inscrição no HackaHub</span>
                ) : (
                  <span className="chip bare">site oficial</span>
                )}
                {global && <span className="chip bare">{global.where}</span>}
                {global?.brazil === "sim" && <span className="chip bare border-accent! bg-mint! text-accent!">aberto pra brasileiros</span>}
                {prize && <span className="chip bare max-w-[180px] truncate">{prize}</span>}
                {closing && <span className="chip bare border-orange! text-orange!">{closing}</span>}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
