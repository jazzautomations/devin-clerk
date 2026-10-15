import type { ReactNode } from "react";
import type { Hackathon } from "@/lib/hackathons";
import { brazilCanJoin, compactPrize, prizeBrlApprox, radarBadges } from "@/lib/radar";

// Página de evento do radar (/h/[id] de quem não é edição da casa): o que a
// pessoa precisa pra decidir antes de ir pro site oficial — alcance, se
// brasileiro pode (com o trecho da regra e o link), prazos e prêmio.
const fmt = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "America/Sao_Paulo",
});

function date(v: string | null | undefined): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : fmt.format(d);
}

const BRAZIL_TEXT = {
  sim: "Sim",
  nao: "Não",
  null: "Não informado",
} as const;

export function RadarEventFacts({ h, now }: { h: Hackathon; now: Date }) {
  const b = radarBadges(h, now);
  const ok = brazilCanJoin(h);
  const prize = compactPrize(h.prize);
  const brl = prizeBrlApprox(h);
  const ruleUrl = h.eligibilityUrl ?? h.registrationUrl;
  const rows: [string, ReactNode][] = [["alcance", b.where]];
  rows.push([
    "brasileiro pode?",
    <span key="b" className="flex flex-col gap-1.5">
      <span
        data-testid="radar-brasileiro-pode"
        className={ok === "sim" ? "text-accent" : ok === "nao" ? "text-[#ba3919]" : "text-muted"}
      >
        {BRAZIL_TEXT[ok ?? "null"]}
      </span>
      {h.eligibilityNote && (
        <q className="font-mono text-[12.5px] leading-snug font-normal text-muted">{h.eligibilityNote}</q>
      )}
      {!h.eligibilityNote && ok === null && (
        <span className="text-[13.5px] font-normal text-muted">A página do evento não diz de quais países aceita. Confira antes de se inscrever.</span>
      )}
      {(h.eligibilityUrl || ok === null) && (
        <a href={ruleUrl} target="_blank" rel="noopener" className="w-fit font-mono text-[12.5px] font-normal text-accent underline-offset-4 hover:underline">
          ler a regra no site oficial ↗
        </a>
      )}
    </span>,
  ]);
  const reg = date(h.registrationDeadline);
  const sub = date(h.submissionDeadline);
  if (reg) rows.push(["inscrição até", reg]);
  if (sub && sub !== reg) rows.push(["entrega até", sub]);
  if (prize) rows.push(["prêmio", brl ? `${prize} (${brl})` : prize]);
  rows.push(["quem organiza", h.brand && !h.organizer.includes(h.brand) ? `${h.organizer} · ${h.brand}` : h.organizer]);

  return (
    <section aria-label="Antes de se inscrever" className="border-2 border-line" data-testid="radar-fatos">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-line px-5 py-3">
        <h2 className="font-mono text-[13px] tracking-[0.06em] uppercase">antes de se inscrever</h2>
        {b.closing && <span className="bg-foreground px-2 py-0.5 font-mono text-[12px] text-band">{b.closing}</span>}
      </div>
      <dl className="px-5 text-[14.5px]">
        {rows.map(([k, v], i) => (
          <div key={k} className={`grid grid-cols-[110px_1fr] gap-3 py-2.5 sm:grid-cols-[140px_1fr] ${i ? "border-t border-line" : ""}`}>
            <dt className="font-mono text-[12px] tracking-[0.04em] text-muted uppercase">{k}</dt>
            <dd className="min-w-0 font-semibold break-words">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="border-t-2 border-line px-5 py-4">
        <a href={h.registrationUrl} target="_blank" rel="noopener" className="btn w-full sm:w-auto" data-testid="radar-cta-oficial">
          inscrever no site oficial ↗
        </a>
      </div>
    </section>
  );
}
