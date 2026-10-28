import type { Metadata } from "next";
import Link from "next/link";
import {
  challengeCommunities,
  communitiesICanChallenge,
  formatDeadline,
  listOpenChallenges,
  timeLeft,
  type OpenChallenge,
} from "@/lib/openChallenges";
import { currentMember } from "@/lib/session";

export const metadata: Metadata = {
  title: "desafios",
  description: "Desafios abertos das comunidades: construa entre um hackathon e outro, com prazo e resultado público.",
  robots: { index: false },
};

// /desafios (migration 053): os abertos com o prazo mais próximo primeiro e
// os encerrados (com resultado ou esperando). ?comunidade=slug filtra.

function ChallengeRow({ c }: { c: OpenChallenge }) {
  const closed = c.phase !== "aberto";
  return (
    <li className="border-t-2 border-line" data-testid="desafio-row">
      <Link
        href={`/desafios/${c.id}`}
        className="group grid min-w-0 grid-cols-1 gap-x-6 gap-y-2 py-4 hover:bg-mint sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-2"
      >
        <span className="min-w-0">
          <span className="block font-mono text-[12.5px] text-muted">
            {c.communityName}
            {c.sponsorName && <> · patrocinado por {c.sponsorName}</>}
          </span>
          <span className="mt-1 block text-[clamp(1.1rem,2.4vw,1.4rem)] leading-tight font-extrabold tracking-[-0.025em] break-words group-hover:underline">
            {c.title}
          </span>
          {c.prize && <span className="mt-1.5 block text-[14.5px] break-words text-[#2b2b2b]">Prêmio: {c.prize}</span>}
        </span>
        <span className="flex flex-wrap items-center gap-1.5 sm:flex-col sm:items-end">
          {closed ? (
            <span className={`chip bare ${c.phase === "resultado" ? "bg-foreground! text-band!" : ""}`}>
              {c.phase === "resultado" ? "resultado saiu" : "encerrado"}
            </span>
          ) : (
            <span className="chip bare border-accent! bg-mint! text-accent!">{timeLeft(c.deadline)}</span>
          )}
          <span className="font-mono text-[12px] text-muted">
            {closed ? "acabou" : "até"} {formatDeadline(c.deadline)} · {c.entryCount} {c.entryCount === 1 ? "entrega" : "entregas"}
          </span>
        </span>
      </Link>
    </li>
  );
}

export default async function DesafiosPage({ searchParams }: PageProps<"/desafios">) {
  const sp = await searchParams;
  const slug = typeof sp.comunidade === "string" ? sp.comunidade : null;
  const [member, communities] = await Promise.all([currentMember(), challengeCommunities()]);
  const selected = slug ? communities.find((c) => c.slug === slug) ?? null : null;
  const [{ open, closed }, mine] = await Promise.all([
    // filtro com slug desconhecido mostra a lista vazia, não a lista inteira
    slug && !selected ? Promise.resolve({ open: [], closed: [] }) : listOpenChallenges({ communityId: selected?.id ?? null }),
    member ? communitiesICanChallenge(member.id) : Promise.resolve([]),
  ]);

  return (
    <section className="mx-auto flex w-full max-w-6xl flex-col gap-10 overflow-x-clip px-4 py-12 sm:px-6 sm:py-16" data-testid="desafios-page">
      <header className="flex flex-col gap-5 border-b-2 border-line pb-8 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-3">
          <p className="tag self-start">DESAFIOS</p>
          <h1 className="text-[clamp(2.3rem,6vw,3.75rem)] leading-[0.95] font-extrabold tracking-[-0.04em]">
            Construa entre um hackathon e outro.
          </h1>
          <p className="max-w-[56ch] text-[16px] leading-relaxed text-[#2b2b2b]">
            Cada desafio tem prazo e prêmio. Você entrega um projeto seu do HackaHub ou um repo, e quem criou o desafio escolhe os
            três primeiros.
          </p>
        </div>
        {mine.length > 0 && (
          <div className="flex shrink-0 flex-col gap-2 self-start sm:items-end sm:self-auto" data-testid="desafios-criar">
            {mine.length === 1 ? (
              <Link href={`/comunidade/${mine[0].slug}/desafios/novo`} className="btn">
                criar desafio →
              </Link>
            ) : (
              <details className="relative">
                <summary className="btn cursor-pointer list-none">criar desafio →</summary>
                <ul className="absolute right-0 z-10 mt-2 w-[min(280px,calc(100vw-2rem))] border-[1.5px] border-line bg-background">
                  {mine.map((c) => (
                    <li key={c.slug} className="border-t border-line-soft first:border-t-0">
                      <Link href={`/comunidade/${c.slug}/desafios/novo`} className="block px-4 py-3 text-[15px] font-semibold hover:bg-mint">
                        {c.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </header>

      {communities.length > 1 && (
        <nav aria-label="filtrar por comunidade" className="flex flex-wrap gap-2" data-testid="desafios-filtro">
          <Link
            href="/desafios"
            aria-current={!slug ? "page" : undefined}
            className={`chip bare min-h-[32px] px-3! ${!slug ? "bg-foreground! text-band!" : "hover:bg-mint"}`}
          >
            todas
          </Link>
          {communities.map((c) => (
            <Link
              key={c.slug}
              href={`/desafios?comunidade=${encodeURIComponent(c.slug)}`}
              aria-current={slug === c.slug ? "page" : undefined}
              className={`chip bare min-h-[32px] max-w-full truncate px-3! ${slug === c.slug ? "bg-foreground! text-band!" : "hover:bg-mint"}`}
            >
              {c.name}
            </Link>
          ))}
        </nav>
      )}

      <div className="flex flex-col gap-3">
        <h2 className="font-mono text-[13px] tracking-[0.08em] uppercase">
          abertos{selected && ` · ${selected.name}`} <span className="text-muted">{open.length}</span>
        </h2>
        {open.length > 0 ? (
          <ul className="border-b-2 border-line" data-testid="desafios-abertos">
            {open.map((c) => (
              <ChallengeRow key={c.id} c={c} />
            ))}
          </ul>
        ) : (
          <div className="flex flex-col items-start gap-3 border-[1.5px] border-line p-5" data-testid="desafios-vazio">
            <p className="text-[17px] font-bold">Nenhum desafio aberto. Sua comunidade pode criar um.</p>
            {mine.length > 0 ? (
              <Link href={`/comunidade/${mine[0].slug}/desafios/novo`} className="cta-link go text-[16px]">
                Criar desafio em {mine[0].name}
              </Link>
            ) : (
              <p className="text-[14.5px] text-muted">
                Quem organiza uma comunidade cria desafio por aqui.{" "}
                <Link href="/comunidades" className="text-accent underline underline-offset-4">
                  Ver comunidades
                </Link>
              </p>
            )}
          </div>
        )}
      </div>

      {closed.length > 0 && (
        <div className="flex flex-col gap-3">
          <h2 className="font-mono text-[13px] tracking-[0.08em] uppercase">
            encerrados <span className="text-muted">{closed.length}</span>
          </h2>
          <ul className="border-b-2 border-line" data-testid="desafios-encerrados">
            {closed.map((c) => (
              <ChallengeRow key={c.id} c={c} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
