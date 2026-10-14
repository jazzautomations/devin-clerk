import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatBrt, STATUS_LABEL, type EntryStatus } from "@/lib/entries";
import { getEditionEntriesView } from "@/lib/entriesPublic";
import { getHackathon } from "@/lib/hackathons";

// spec 034 — projetos da edição: resultados por categoria (depois da
// publicação), mostruário com filtro "tem vídeo" e todas as entregas com
// status. Respeita a matriz de visibilidade (antes do prazo: só contagem).

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ video?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const h = await getHackathon(id);
  if (!h || !h.active) return { title: "edição não encontrada" };
  return { title: `Projetos · ${h.name}`, alternates: { canonical: `/h/${h.id}/projetos` } };
}

const STATUS_CLASS: Record<EntryStatus, string> = {
  rascunho: "border-line text-muted",
  enviado: "border-accent text-accent",
  travado: "border-accent bg-mint text-accent",
  nao_entregue: "border-orange text-orange",
};

export default async function EditionProjectsPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { video } = await searchParams;
  const h = await getHackathon(id);
  if (!h || !h.active) notFound();
  const view = await getEditionEntriesView(h.id);
  const onlyVideo = video === "1";
  const showcase = view.entries.filter((e) => e.showContent && (!onlyVideo || e.videoUrl || e.stageVideoUrl));
  const h2 = "font-mono text-[12px] tracking-[0.06em] text-muted uppercase";

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 py-10 sm:px-6">
      <header className="flex flex-col gap-3 border-b-2 border-line pb-5">
        <p className="font-mono text-[12px] tracking-widest text-muted uppercase">
          <Link href={`/h/${h.id}`} className="hover:text-accent">
            {h.name}
          </Link>
        </p>
        <h1 className="text-[clamp(2rem,6vw,3.4rem)] leading-none font-extrabold tracking-[-0.04em]">Projetos</h1>
        <p data-testid="entries-counts" className="font-mono text-[14px]">
          {view.counts.teams} {view.counts.teams === 1 ? "time" : "times"} · {view.counts.submitted}{" "}
          {view.counts.submitted === 1 ? "entregue" : "entregues"}
        </p>
      </header>

      {view.phase === "antes" && (
        <p data-testid="entries-locked" className="border-[1.5px] border-line px-5 py-6 text-[15px] text-muted">
          Os projetos aparecem aqui quando a entrega fechar
          {view.lockAt ? ` (${formatBrt(view.lockAt)}, horário de Brasília)` : ""}. Até lá, só a contagem é pública.
        </p>
      )}

      {view.results.length > 0 && (
        <section data-testid="entries-results" className="flex flex-col gap-4">
          <h2 className={h2}>resultados</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {view.results.map((r) => (
              <div key={r.categoryId} className="flex min-w-0 flex-col gap-2 border-[1.5px] border-line p-4">
                <p className="font-mono text-[11px] tracking-widest text-muted uppercase">
                  {r.kind === "desafio" ? "desafio patrocinado" : "geral"}
                </p>
                <h3 className="text-[20px] leading-tight font-extrabold tracking-[-0.02em] break-words">{r.name}</h3>
                <ol className="flex flex-col">
                  {r.winners.map((w) => (
                    <li key={w.teamId} className="flex items-baseline gap-3 border-t border-line py-2">
                      <span className="pix text-[22px] leading-none text-accent">{w.place}º</span>
                      <Link href={`/p/${w.teamId}`} className="min-w-0 font-semibold break-words hover:text-accent">
                        {w.title ?? w.teamName}
                        {w.title && <span className="font-mono text-[12px] font-normal text-muted"> · {w.teamName}</span>}
                      </Link>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </section>
      )}

      {view.phase !== "antes" && (
        <section data-testid="entries-showcase" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className={h2}>mostruário</h2>
            <nav className="flex gap-4 font-mono text-[13px]">
              <Link href={`/h/${h.id}/projetos`} className={onlyVideo ? "text-muted hover:text-accent" : "text-accent underline underline-offset-4"}>
                todos
              </Link>
              <Link
                href={`/h/${h.id}/projetos?video=1`}
                className={onlyVideo ? "text-accent underline underline-offset-4" : "text-muted hover:text-accent"}
              >
                tem vídeo
              </Link>
            </nav>
          </div>
          {showcase.length === 0 ? (
            <p className="text-muted">{onlyVideo ? "Nenhum projeto com vídeo." : "Nenhum projeto pra mostrar ainda."}</p>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {showcase.map((e) => (
                <li key={e.teamId} className="flex min-w-0 flex-col gap-2 border-[1.5px] border-line p-4">
                  <div className="flex flex-wrap gap-1.5">
                    {e.awards.map((a) => (
                      <span key={a} className="border border-lendario bg-lendario/10 px-1.5 py-0.5 font-mono text-[11px] text-lendario">
                        {a}
                      </span>
                    ))}
                    {e.finalist && view.phase === "publicado" && (
                      <span className="border border-accent px-1.5 py-0.5 font-mono text-[11px] text-accent">finalista</span>
                    )}
                    {(e.videoUrl || e.stageVideoUrl) && (
                      <span className="border border-line px-1.5 py-0.5 font-mono text-[11px] text-muted">vídeo</span>
                    )}
                  </div>
                  <Link href={`/p/${e.teamId}`} className="text-[19px] leading-tight font-extrabold tracking-[-0.02em] break-words hover:text-accent">
                    {e.title}
                  </Link>
                  {e.tagline && <p className="text-[14px] text-muted break-words">{e.tagline}</p>}
                  {e.technologies.length > 0 && (
                    <p className="font-mono text-[12px] break-words text-muted">{e.technologies.slice(0, 5).join(" · ")}</p>
                  )}
                  <p className="mt-auto font-mono text-[12px] text-muted">{e.teamName}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {view.phase !== "antes" && (
        <section data-testid="entries-all" className="flex flex-col gap-4">
          <h2 className={h2}>todas as entregas</h2>
          {view.entries.length === 0 ? (
            <p className="text-muted">Nenhum time na edição.</p>
          ) : (
            <ul className="border-b border-line">
              {view.entries.map((e) => (
                <li key={e.teamId} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-line py-3">
                  <div className="min-w-0">
                    <p className="font-extrabold tracking-[-0.02em] break-words">{e.teamName}</p>
                    {e.title &&
                      (e.status === "nao_entregue" ? (
                        <p className="text-[14px] text-muted break-words">{e.title}</p>
                      ) : (
                        <Link href={`/p/${e.teamId}`} className="text-[14px] break-words text-foreground hover:text-accent">
                          {e.title}
                        </Link>
                      ))}
                  </div>
                  <span className={`border px-1.5 py-0.5 font-mono text-[11px] uppercase ${STATUS_CLASS[e.status]}`}>
                    {STATUS_LABEL[e.status]}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
