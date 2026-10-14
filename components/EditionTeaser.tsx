import Link from "next/link";
import type { Hackathon } from "@/lib/hackathons";
import type { EditionSponsor } from "@/lib/editionSponsors";
import type { Challenge } from "@/lib/challenges";
import { EditionSponsors } from "@/components/EditionSponsors";

// spec 039 — teaser público da edição (link de divulgação no Instagram/zap).
// Mostra só o que vende a edição: nome, data, local, prêmio, desafios e
// patrocinadores. Inscritos, times, programação e mural ficam pra quem
// entra. O CTA cria a conta e volta direto pra inscrição desta edição.

const FORMAT_LABEL: Record<string, string> = { online: "online", presencial: "presencial", hibrido: "híbrido" };
const tz = "America/Sao_Paulo";

export function EditionTeaser({
  h,
  past,
  closed,
  approved,
  capacity,
  remaining,
  sponsors,
  challenges,
}: {
  h: Hackathon;
  past: boolean;
  closed: boolean;
  approved: number;
  capacity: number | null;
  remaining: number | null;
  sponsors: EditionSponsor[];
  challenges: Challenge[];
}) {
  const d = new Date(h.startsAt);
  const dia = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", timeZone: tz }).format(d);
  const mes = new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: tz }).format(d).replace(".", "").toUpperCase();
  const ano = new Intl.DateTimeFormat("pt-BR", { year: "numeric", timeZone: tz }).format(d);
  const longo = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: tz }).format(d);
  const inscricao = `/h/${h.id}/inscricao`;
  const signup = `/sign-up?redirect_url=${encodeURIComponent(h.partner ? inscricao : `/h/${h.id}`)}`;
  const signin = `/sign-in?redirect_url=${encodeURIComponent(h.partner ? inscricao : `/h/${h.id}`)}`;
  const prizes = challenges.filter((c) => c.prize);

  const rows: [string, string][] = [
    ["data", longo],
    ["local", h.location ?? "Online"],
    ["formato", FORMAT_LABEL[h.format]],
  ];
  if (h.prize) rows.push(["prêmio", h.prize]);
  if (h.partner && !past) {
    rows.push([
      "inscrições",
      closed
        ? "encerradas"
        : h.registrationDeadline
          ? `até ${new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", timeZone: tz }).format(new Date(h.registrationDeadline))}`
          : "abertas",
    ]);
    if (capacity !== null && remaining !== null) rows.push(["vagas", remaining === 0 ? "esgotadas · fila aberta" : `${remaining} de ${capacity} livres`]);
  }
  if (h.partner && approved > 0) rows.push(["inscritos", String(approved)]);

  return (
    <div className="overflow-x-clip" data-testid="edition-teaser">
      <div className="strip">
        <div className="mx-auto flex max-w-6xl flex-wrap justify-between gap-x-6 gap-y-0.5 px-4 py-1.5 sm:px-6">
          <span>
            {dia} {mes} {ano} · {FORMAT_LABEL[h.format].toUpperCase()} · {(h.location ?? "online").toUpperCase()}
          </span>
          <span>{past ? "EDIÇÃO ENCERRADA" : !h.partner ? "EVENTO NO RADAR" : closed ? "INSCRIÇÕES ENCERRADAS" : "INSCRIÇÕES ABERTAS"}</span>
        </div>
      </div>

      <header className="mx-auto grid max-w-6xl gap-8 px-4 pt-8 pb-10 sm:px-6 sm:pt-14 lg:grid-cols-[1.4fr_1fr] lg:items-end lg:gap-14">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="tag uppercase">{past ? "arquivo" : "hackathon"}</p>
            {h.partner && <span className="chip bare">edição hack inova</span>}
          </div>
          <h1 className="mt-5 text-[clamp(2.4rem,7vw,5.25rem)] leading-[0.92] font-extrabold tracking-[-0.045em] break-words">{h.name}</h1>
          <p className="mt-4 text-[17px] text-muted">
            Realização <strong className="font-bold text-foreground">{h.organizer}</strong>
          </p>
          {h.tags.length > 0 && (
            <div className="mt-5 flex flex-wrap gap-1.5">
              {h.tags.map((t) => (
                <span key={t} className="chip">
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className="border-t-[3px] border-b border-line">
          <p className="flex items-baseline gap-2 pt-4 text-[clamp(3.2rem,8vw,4.75rem)] leading-none font-extrabold tracking-[-0.04em] tabular-nums">
            {dia}
            <span className="text-[0.5em] text-accent">
              {mes} {ano}
            </span>
          </p>
          <dl className="mt-4 text-[14.5px]">
            {rows.map(([k, v]) => (
              <div key={k} className="grid grid-cols-[96px_1fr] gap-3 border-t border-line py-2.5">
                <dt className="font-mono text-[12px] tracking-[0.04em] text-muted uppercase">{k}</dt>
                <dd className="font-semibold first-letter:uppercase">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </header>

      {/* CTA: criar conta e cair direto na inscrição desta edição */}
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <section aria-label="Participar desta edição" className="border-2 border-line bg-foreground text-background" data-testid="teaser-cta">
          <div className="grid gap-6 px-5 py-6 sm:px-7 sm:py-8 lg:grid-cols-[1.3fr_1fr] lg:items-center">
            <div>
              <p className="font-mono text-[12px] tracking-[0.06em] text-band uppercase">
                {past ? "edição encerrada" : h.partner && !closed ? "participar" : "acompanhar"}
              </p>
              <p className="mt-2 text-[clamp(1.6rem,3.6vw,2.4rem)] leading-[1.02] font-extrabold tracking-[-0.03em]">
                {past
                  ? "Resultado, projetos e pódio ficam pra quem tem conta."
                  : h.partner && !closed
                    ? "Cria tua conta e já cai na inscrição."
                    : "Entra pra acompanhar a edição."}
              </p>
              <p className="mt-3 max-w-[52ch] text-[14.5px] leading-relaxed text-[#b8cdc0]">
                Lá dentro: programação, avisos, quem tá procurando time, mural da edição, ingresso com QR e certificado.
              </p>
            </div>
            <div className="flex flex-col gap-3 lg:items-end">
              <Link href={signup} className="btn-go w-full lg:w-auto" data-testid="teaser-signup">
                {past ? "criar conta e ver o resultado" : h.partner && !closed ? "criar conta e se inscrever" : "criar conta"} →
              </Link>
              <Link href={signin} className="font-mono text-[13px] text-band underline-offset-4 hover:underline">
                já tenho conta · entrar
              </Link>
              {!h.partner && !past && (
                <a href={h.registrationUrl} target="_blank" rel="noopener" className="font-mono text-[13px] text-[#b8cdc0] underline-offset-4 hover:underline">
                  inscrição no site oficial ↗
                </a>
              )}
            </div>
          </div>
        </section>
      </div>

      {prizes.length > 0 && (
        <section aria-labelledby="teaser-desafios" className="mx-auto max-w-6xl px-4 pt-14 sm:px-6">
          <h2 id="teaser-desafios" className="border-t-2 border-line pt-5 text-[clamp(1.6rem,3vw,2.1rem)] leading-none font-extrabold tracking-[-0.035em]">
            Desafios e prêmios
          </h2>
          <ul className="mt-5 grid gap-px border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
            {prizes.map((c) => (
              <li key={c.id} className="flex flex-col gap-2 bg-background p-5">
                <p className="font-mono text-[12px] tracking-[0.06em] text-accent uppercase">{c.sponsor}</p>
                <p className="text-[19px] leading-tight font-extrabold tracking-[-0.02em]">{c.title}</p>
                <p className="prize-badge w-fit">prêmio: {c.prize}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {sponsors.length > 0 && (
        <section aria-labelledby="teaser-patro" className="mx-auto max-w-6xl px-4 pt-14 sm:px-6">
          <h2 id="teaser-patro" className="mb-5 border-t-2 border-line pt-5 text-[clamp(1.6rem,3vw,2.1rem)] leading-none font-extrabold tracking-[-0.035em]">
            Patrocinadores
          </h2>
          <EditionSponsors sponsors={sponsors} />
        </section>
      )}

      {h.partner && (
        <p className="mx-auto max-w-6xl px-4 pt-10 font-mono text-[13px] text-muted sm:px-6">
          <Link href={`/h/${h.id}/conduta`} className="text-accent underline-offset-4 hover:underline">
            código de conduta da edição →
          </Link>
          <span className="mx-3">·</span>
          <Link href={`/h/${h.id}/incidente`} className="text-accent underline-offset-4 hover:underline">
            relatar um problema →
          </Link>
        </p>
      )}
    </div>
  );
}
