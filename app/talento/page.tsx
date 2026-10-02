import Link from "next/link";
import type { Metadata } from "next";
import { listTalent } from "@/lib/talent";
import { levelFor } from "@/lib/game";
import { Avatar } from "@/components/Avatar";

// diretório público "open to" — spec 014. Participante nunca paga: a vitrine
// é pra empresa que quer alcançar quem prova em hackathon.

export const metadata: Metadata = {
  title: "talento",
  description:
    "Quem constrói de verdade: membros do hackahub abertos a trampo, cofundadoria, freela e mentoria — com projetos entregues e pódio verificável.",
  alternates: { canonical: "/talento" },
};

export default async function TalentoPage() {
  const talent = listTalent(100);

  return (
    <section className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-16">
      <div className="flex flex-col gap-3">
        <p className="font-mono text-xs tracking-widest text-accent">
          {"// talento"}
        </p>
        <h1 className="font-display text-4xl font-bold tracking-tight">
          quem constrói de verdade
        </h1>
        <p className="max-w-xl text-lg text-muted">
          Essas pessoas entregaram em hackathon — projetos no arquivo, pódio
          registrado, skills à mostra. Contrate quem prova: participante nunca
          paga, quem paga é a empresa que quer alcançar elas.
        </p>
      </div>

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
                      className="font-display font-semibold tracking-tight transition hover:text-accent"
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
                      <span className="border border-line bg-surface px-1.5 font-mono text-[10px] text-foreground">
                        {t.persona}
                      </span>
                    )}
                  </div>
                  {t.headline && (
                    <p className="font-mono text-xs text-muted">{t.headline}</p>
                  )}
                  {/* openTo é o sinal comercial — leva o acento */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[10px] text-muted">
                      open to:
                    </span>
                    {t.openTo.map((o) => (
                      <span
                        key={o}
                        className="border border-accent/50 bg-accent/10 px-1.5 font-mono text-[10px] text-accent"
                      >
                        {o}
                      </span>
                    ))}
                  </div>
                  {t.skills.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {t.skills.slice(0, 8).map((s) => (
                        <span
                          key={s}
                          className="border border-line px-1.5 font-mono text-[10px] text-muted"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 flex-col gap-1.5 sm:items-end sm:text-right">
                  <span className="font-mono text-xs">
                    <span className="text-accent">LV{level.n}</span>{" "}
                    <span className="text-muted">
                      {level.name} · {t.xp} xp
                    </span>
                  </span>
                  <span className="font-mono text-[10px] text-muted">
                    {t.projects}{" "}
                    {t.projects === 1 ? "projeto entregue" : "projetos entregues"}
                  </span>
                  {t.best && (
                    <Link
                      href={`/h/${t.best.hackathonId}`}
                      className="w-fit border border-lendario/50 bg-lendario/10 px-1.5 font-mono text-[10px] text-lendario transition hover:brightness-125"
                    >
                      {t.best.placement}º lugar · {t.best.hackathonName}
                    </Link>
                  )}
                  {t.github && (
                    <a
                      href={`https://github.com/${t.github.replace(/^@/, "")}`}
                      target="_blank"
                      rel="noopener"
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
        <p className="border border-dashed border-line px-5 py-8 text-center font-mono text-xs text-muted">
          {
            "// ninguém marcou \"open to\" ainda — se tu constrói em hackathon, marca no teu /perfil e entra na vitrine"
          }
        </p>
      )}
    </section>
  );
}
