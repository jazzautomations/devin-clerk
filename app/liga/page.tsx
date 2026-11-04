import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import { LigaOptInToggle } from "@/components/LigaOptInToggle";
import { listMyCommunities } from "@/lib/communities";
import {
  LEAGUE_LIST_MAX,
  bandSentence,
  leagueBreakdown,
  leagueOptIn,
  leagueStanding,
  ligaEnabled,
  previousSemester,
  rankingOptIn,
  semester,
  type LeagueBand,
  type LeagueStanding,
} from "@/lib/league";
import { currentMember } from "@/lib/session";

export const metadata: Metadata = {
  title: "liga",
  description:
    "A liga do semestre por faixa: o que você entregou entre uma edição e outra, comparado com o semestre passado. Sem placar geral.",
  robots: { index: false },
};

// /liga (spec 046, onda 5: liga-por-faixa, migration 054). Mostra a FAIXA da
// pessoa no semestre, a comparação com o semestre passado e, só pra quem
// ativou o opt-in, a lista de quem também ativou. Nunca posição numérica.
// Desligada por flag (HACKAHUB_LIGA_ON): 404 e o link do XpBar não aparece.

function BandChip({ band, strong = false }: { band: LeagueBand; strong?: boolean }) {
  return (
    <span
      className={`chip bare shrink-0 ${strong ? "border-accent! bg-mint! text-accent!" : ""}`}
      data-testid="liga-band"
    >
      {band}
    </span>
  );
}

function StandingCard({ s, title, testid }: { s: LeagueStanding; title: string; testid: string }) {
  const items = leagueBreakdown(s.breakdown);
  return (
    <div className="flex min-w-0 flex-col gap-3 border-[1.5px] border-line p-5" data-testid={testid}>
      <p className="font-mono text-[12px] tracking-[0.08em] text-muted uppercase">
        {title} · {s.sem.label}
      </p>
      <p className="text-[clamp(1.7rem,8vw,2.4rem)] leading-[0.95] font-extrabold tracking-[-0.035em] break-words">
        {s.band}
      </p>
      <p className="text-[15px] leading-snug">{bandSentence(s.band, s.points)}</p>
      <p className="font-mono text-[12px] text-muted">
        {s.points} {s.points === 1 ? "ponto" : "pontos"} · {s.peers}{" "}
        {s.peers === 1 ? "pessoa com ponto" : "pessoas com ponto"}
      </p>
      {items.length > 0 ? (
        <ul className="flex flex-col border-t border-line">
          {items.map((i) => (
            <li
              key={i.label}
              className="flex items-baseline justify-between gap-3 border-b border-line py-1.5 font-mono text-[12px]"
            >
              <span className="min-w-0 break-words text-foreground">{i.label}</span>
              <span className="shrink-0 text-muted">{i.points} pts</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="font-mono text-[12px] text-muted">Nenhuma entrega contada neste semestre.</p>
      )}
    </div>
  );
}

export default async function LigaPage({ searchParams }: PageProps<"/liga">) {
  if (!ligaEnabled()) notFound();
  const sp = await searchParams;
  const member = await currentMember();
  if (!member) notFound();

  const sem = semester();
  const past = previousSemester(sem);
  const [now, before, optIn, communities] = await Promise.all([
    leagueStanding(member.id, sem),
    leagueStanding(member.id, past),
    leagueOptIn(member.id),
    listMyCommunities(member.id),
  ]);

  const slug = typeof sp.comunidade === "string" ? sp.comunidade : null;
  const selected = slug ? (communities.find((c) => c.slug === slug) ?? null) : null;
  // filtro com slug desconhecido mostra a lista vazia, não a lista inteira
  const list =
    optIn && !(slug && !selected)
      ? await rankingOptIn(sem, { communityId: selected?.id ?? null, viewerId: member.id })
      : [];

  const chip = (active: boolean) =>
    `chip bare min-h-[32px] px-3! ${active ? "bg-foreground! text-band!" : "hover:bg-mint"}`;

  return (
    <section
      className="mx-auto flex w-full max-w-4xl flex-col gap-10 overflow-x-clip px-4 py-12 sm:px-6 sm:py-16"
      data-testid="liga-page"
    >
      <header className="flex flex-col gap-3 border-b-2 border-line pb-8">
        <p className="tag self-start">LIGA</p>
        <h1 className="text-[clamp(2.1rem,6vw,3.4rem)] leading-[0.95] font-extrabold tracking-[-0.04em]">
          A liga do semestre.
        </h1>
        <p className="max-w-[56ch] text-[16px] leading-relaxed text-[#2b2b2b]">
          A liga soma o que você entregou neste semestre. Cada temporada é um semestre: mar–jul e
          ago–dez.
        </p>
      </header>

      <div className="flex flex-col gap-3">
        <h2 className="font-mono text-[13px] tracking-[0.08em] uppercase">
          sua faixa <span className="text-muted">neste semestre e no passado</span>
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <StandingCard s={now} title="neste semestre" testid="liga-faixa-atual" />
          <StandingCard s={before} title="no passado" testid="liga-faixa-passado" />
        </div>
        <p className="text-[14.5px] leading-relaxed text-muted">
          Entram entrega travada, prêmio e semana de acompanhamento cumprida, contados só em edição
          que roda no HackaHub com pelo menos 15 check-ins. A faixa é uma foto do semestre: ela não
          cai quando você fica um tempo fora.
        </p>
      </div>

      <div className="flex flex-col gap-3 border-[1.5px] border-line p-5" data-testid="liga-optin">
        <h2 className="font-mono text-[13px] tracking-[0.08em] uppercase">lista da liga</h2>
        <LigaOptInToggle initial={optIn} />
        <p className="text-[14.5px] leading-relaxed text-muted">
          A lista mostra nome e faixa de quem ativou, sem posição e sem placar de popularidade.
        </p>
      </div>

      {optIn ? (
        <div className="flex flex-col gap-3" data-testid="liga-lista">
          <h2 className="font-mono text-[13px] tracking-[0.08em] uppercase">
            quem também está na liga <span className="text-muted">{list.length}</span>
          </h2>
          {communities.length > 0 && (
            <nav aria-label="filtrar por comunidade" className="flex flex-wrap gap-2" data-testid="liga-filtro">
              <Link href="/liga" aria-current={!selected ? "page" : undefined} className={chip(!selected)}>
                todas
              </Link>
              {communities.map((c) => (
                <Link
                  key={c.slug}
                  href={`/liga?comunidade=${encodeURIComponent(c.slug)}`}
                  aria-current={selected?.slug === c.slug ? "page" : undefined}
                  className={`${chip(selected?.slug === c.slug)} max-w-full truncate`}
                >
                  {c.name}
                </Link>
              ))}
            </nav>
          )}
          {list.length > 0 ? (
            <ul className="flex flex-col border-b-2 border-line" data-testid="liga-lista-rows">
              {list.map((r) => (
                <li
                  key={r.username}
                  className="flex min-w-0 items-center gap-3 border-t border-line py-3"
                  data-testid={`liga-row-${r.username}`}
                >
                  <Avatar username={r.username} name={r.name} avatarUrl={r.avatarUrl} size="md" />
                  <Link href={`/u/${r.username}`} className="group min-w-0 flex-1">
                    <span className="block truncate font-bold transition group-hover:text-accent">
                      {r.name ?? `@${r.username}`}
                      {r.id === member.id && <span className="font-mono text-[12px] text-muted"> · você</span>}
                    </span>
                    <span className="block truncate font-mono text-[12px] text-muted">@{r.username}</span>
                  </Link>
                  <BandChip band={r.band} strong={r.band === "top 10%"} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="border-[1.5px] border-line px-5 py-8 text-center font-mono text-xs text-muted">
              {slug && !selected
                ? "Essa comunidade não está na sua lista."
                : "Ninguém daqui ativou a lista ainda."}
            </p>
          )}
          {list.length >= LEAGUE_LIST_MAX && (
            <p className="font-mono text-[12px] text-muted">Mostrando as primeiras {LEAGUE_LIST_MAX} pessoas.</p>
          )}
        </div>
      ) : (
        <p
          className="border-[1.5px] border-line px-5 py-8 text-center font-mono text-xs text-muted"
          data-testid="liga-lista-fechada"
        >
          A lista de quem está na liga aparece pra quem ativa. A sua faixa você vê sempre.
        </p>
      )}
    </section>
  );
}
