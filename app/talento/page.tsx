import Link from "next/link";
import type { Metadata } from "next";
import { listTalent } from "@/lib/talent";
import { levelFor } from "@/lib/game";
import { Avatar } from "@/components/Avatar";
import { MemberFilters } from "@/components/MemberFilters";
import { openToLabel } from "@/lib/openTo";
import { isAreaKey } from "@/lib/areas";

// diretório público "disponível para" (open to) — spec 014. Participante nunca paga: a vitrine
// é pra empresa que quer alcançar quem prova em hackathon.
//
// Perfil rico (migration 041): os mesmos filtros de /membros e a contagem de
// depoimentos de time com o primeiro trecho, que é a prova social que a 044
// pede no cartão.

export const metadata: Metadata = {
  title: "talento",
  description:
    "Quem constrói de verdade: membros do HackaHub disponíveis para emprego, sociedade, freela e mentoria, com projetos entregues e pódio verificável.",
  alternates: { canonical: "/talento" },
};

const areaParam = (v: string | undefined) => (isAreaKey(v) ? v : undefined);
const textParam = (v: string | undefined) => v?.trim() || undefined;

export default async function TalentoPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; oferece?: string; quer?: string; cidade?: string; faculdade?: string }>;
}) {
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const filter = {
    oferece: areaParam(sp.oferece),
    quer: areaParam(sp.quer),
    cidade: textParam(sp.cidade),
    faculdade: textParam(sp.faculdade),
  };
  const talent = await listTalent(100, q, filter);
  const filtered = !!(q || filter.oferece || filter.quer || filter.cidade || filter.faculdade);

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-16 sm:px-6">
      <div className="flex flex-col gap-3">
        <p className="tag self-start uppercase">
          {"talento"}
        </p>
        <h1 className="font-display text-[clamp(2.4rem,6vw,3.75rem)] font-extrabold tracking-[-0.035em] leading-[0.95]">
          Quem constrói de verdade
        </h1>
        {/* a frase fala "dessas pessoas": só aparece quando tem alguém na lista */}
        {talent.length > 0 && (
          <p className="max-w-xl text-lg text-muted">
            Essas pessoas entregaram em hackathon, com projeto no arquivo e
            pódio registrado. Contrate quem prova. Participante nunca paga;
            quem paga é a empresa que quer falar com elas.
          </p>
        )}
      </div>

      <MemberFilters action="/talento" values={{ q, ...filter }} />

      <ul className="flex flex-col gap-2">
        {talent.map((t) => {
          const { level } = levelFor(t.xp);
          return (
            <li
              key={t.username}
              data-username={t.username}
              className="border border-line bg-background transition hover:bg-surface"
            >
              <div className="flex flex-col gap-4 p-4 sm:flex-row sm:gap-6">
                <Avatar
                  username={t.username}
                  name={t.name}
                  avatarUrl={t.avatarUrl}
                  size="md"
                  className="sm:mt-0.5"
                />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <Link
                      href={`/u/${t.username}`}
                      className="font-display font-extrabold tracking-[-0.035em] transition hover:text-accent"
                    >
                      {t.name ?? `@${t.username}`}
                    </Link>
                    <Link
                      href={`/u/${t.username}`}
                      className="font-mono text-xs text-muted transition hover:text-accent"
                    >
                      @{t.username}
                    </Link>
                    {t.persona && (
                      <span className="border border-line bg-surface px-1.5 font-mono text-[12px] text-foreground">
                        {t.persona}
                      </span>
                    )}
                  </div>
                  {t.headline && (
                    <p className="font-mono text-xs text-muted">{t.headline}</p>
                  )}
                  {/* openTo é o sinal comercial — leva o acento */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[12px] text-muted">
                      disponível para:
                    </span>
                    {t.openTo.map((o) => (
                      <span
                        key={o}
                        className="border border-accent bg-mint px-1.5 font-mono text-[12px] text-accent"
                      >
                        {openToLabel(o)}
                      </span>
                    ))}
                  </div>
                  {t.skills.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {t.skills.slice(0, 8).map((s) => (
                        <span
                          key={s}
                          className="border border-line px-1.5 font-mono text-[12px] text-muted"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                  {t.testimonial && (
                    <p
                      className="border-l-[3px] border-accent pl-3 text-[14px] leading-snug text-muted [overflow-wrap:anywhere]"
                      data-testid="talent-testimonial"
                    >
                      {t.testimonial.length > 180 ? `${t.testimonial.slice(0, 179)}…` : t.testimonial}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 flex-col gap-1.5 sm:items-end sm:text-right">
                  <span className="font-mono text-xs">
                    <span className="text-accent">LV{level.n}</span>{" "}
                    <span className="text-muted">
                      {level.name} · {t.xp} xp
                    </span>
                  </span>
                  <span className="font-mono text-[12px] text-muted">
                    {t.projects}{" "}
                    {t.projects === 1 ? "projeto entregue" : "projetos entregues"}
                  </span>
                  {t.testimonials > 0 && (
                    <span className="font-mono text-[12px] text-muted" data-testid="talent-testimonials">
                      {t.testimonials}{" "}
                      {t.testimonials === 1 ? "depoimento de time" : "depoimentos de time"}
                    </span>
                  )}
                  {t.best && (
                    <Link
                      href={`/h/${t.best.hackathonId}`}
                      className="w-fit border border-lendario/50 bg-lendario/10 px-1.5 font-mono text-[12px] text-lendario transition hover:brightness-125"
                    >
                      {t.best.placement}º lugar · {t.best.hackathonName}
                    </Link>
                  )}
                  {t.github && (
                    <a
                      href={`https://github.com/${t.github.replace(/^@/, "")}`}
                      target="_blank"
                      rel="noopener nofollow"
                      className="font-mono text-xs text-accent hover:underline"
                    >
                      github/{t.github.replace(/^@/, "")} →
                    </a>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {talent.length === 0 && (
        <p className="border-[1.5px] border-line px-5 py-8 text-center font-mono text-xs text-muted">
          {filtered ? (
            "Ninguém com esses filtros ainda."
          ) : (
            <>
              ninguém se marcou como disponível ainda. Se você constrói em hackathon, marque no{" "}
              <Link href="/perfil" className="link-inline">
                seu perfil
              </Link>{" "}
              e entre na vitrine.
            </>
          )}
        </p>
      )}
    </section>
  );
}
