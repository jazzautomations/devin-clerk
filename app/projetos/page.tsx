import Link from "next/link";
import type { Metadata } from "next";
import { listProjectEditions, listProjects } from "@/lib/projects";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "projetos",
    description:
      "Todo time que entregou vira portfólio público — o índice de tudo que já nasceu nos hackathons da comunidade.",
    alternates: { canonical: "/projetos" },
    openGraph: { title: "projetos", type: "website" },
  };
}

function hrefFor(f: { h?: string; live?: boolean; q?: string }): string {
  const params = new URLSearchParams();
  if (f.h) params.set("h", f.h);
  if (f.live) params.set("live", "1");
  if (f.q) params.set("q", f.q);
  const qs = params.toString();
  return qs ? `/projetos?${qs}` : "/projetos";
}

export default async function ProjetosPage({
  searchParams,
}: {
  searchParams: Promise<{ h?: string; live?: string; q?: string }>;
}) {
  const { h, live, q: rawQ } = await searchParams;
  const hackathonId = h?.trim() || undefined;
  const liveOnly = live === "1";
  const q = rawQ?.trim() ?? "";

  const projects = listProjects({ hackathonId, liveOnly, q: q || undefined });
  const editions = listProjectEditions();
  const filtering = !!hackathonId || liveOnly || !!q;

  const chip = (active: boolean) =>
    `border px-3 py-1.5 transition ${
      active
        ? "border-accent/50 bg-accent/10 text-accent"
        : "border-line text-muted hover:text-foreground"
    }`;

  return (
    <section className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-16">
      <div className="flex flex-col gap-3">
        <p className="font-mono text-xs tracking-widest text-accent">
          {"// projetos"}
        </p>
        <h1 className="font-display text-4xl font-bold tracking-tight">
          o que já nasceu aqui
        </h1>
        <p className="max-w-xl text-lg text-muted">
          todo time que entregou vira portfólio público — campeões primeiro,
          edição recente desempata
        </p>
        <form action="/projetos" className="mt-1 flex gap-2">
          {hackathonId && (
            <input type="hidden" name="h" value={hackathonId} />
          )}
          {liveOnly && <input type="hidden" name="live" value="1" />}
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="buscar projeto, time…"
            aria-label="buscar projetos"
            className="w-full max-w-md border border-line bg-surface px-4 py-2.5 font-mono text-sm outline-none transition placeholder:text-muted focus:border-accent"
          />
          <button
            type="submit"
            className="border border-line px-4 py-2.5 font-mono text-sm text-muted transition hover:border-accent hover:text-accent"
          >
            buscar
          </button>
        </form>
      </div>

      {editions.length > 0 && (
        <div className="flex flex-wrap gap-2 font-mono text-xs">
          <Link
            href={hrefFor({ live: liveOnly, q })}
            aria-current={!hackathonId ? "page" : undefined}
            className={chip(!hackathonId)}
          >
            todas as edições
          </Link>
          {editions.map((e) => (
            <Link
              key={e.id}
              href={hrefFor({ h: e.id, live: liveOnly, q })}
              aria-current={hackathonId === e.id ? "page" : undefined}
              className={chip(hackathonId === e.id)}
            >
              {e.name}
            </Link>
          ))}
          <Link
            href={hrefFor({ h: hackathonId, live: !liveOnly, q })}
            aria-current={liveOnly ? "page" : undefined}
            className={chip(liveOnly)}
          >
            só ao vivo
          </Link>
        </div>
      )}

      {projects.length > 0 ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {projects.map((c) => (
            <li
              key={c.teamId}
              className={`flex flex-col gap-3 border p-5 ${
                c.placement === 1
                  ? "border-lendario/60 bg-lendario/5"
                  : "border-line bg-surface"
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <Link
                  href={`/p/${c.teamId}`}
                  className="font-display text-lg font-semibold tracking-tight transition hover:text-accent"
                >
                  {c.project.title}
                </Link>
                {c.placement >= 1 && c.placement <= 3 && (
                  <span
                    className={`shrink-0 border px-2 py-1 font-mono text-xs ${
                      c.placement === 1
                        ? "border-lendario/60 bg-lendario/10 text-lendario"
                        : "border-line bg-surface text-muted"
                    }`}
                  >
                    {c.placement}º lugar
                  </span>
                )}
              </div>

              <p className="font-mono text-xs text-muted">
                <Link
                  href={`/h/${c.hackathonId}`}
                  className="transition hover:text-accent"
                >
                  {c.hackathonName}
                </Link>
                {" · "}
                {c.teamName}
                {c.memberCount > 0 &&
                  ` · ${c.memberCount} ${
                    c.memberCount === 1 ? "membro" : "membros"
                  }`}
              </p>

              {c.project.description && (
                <p className="line-clamp-2 text-sm text-muted">
                  {c.project.description}
                </p>
              )}

              <div className="mt-auto flex flex-wrap items-center gap-3 font-mono text-xs">
                {c.liveDeployId && (
                  <a
                    href={`/demo/${c.liveDeployId}/`}
                    className="border border-accent/50 bg-accent/10 px-2 py-1 text-accent transition hover:bg-accent/15"
                  >
                    ● demo ao vivo
                  </a>
                )}
                {c.project.repoUrl && (
                  <a
                    href={c.project.repoUrl}
                    target="_blank"
                    rel="noopener"
                    aria-label={`repositório de ${c.project.title}`}
                    className="text-accent transition hover:underline"
                  >
                    repo →
                  </a>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="border border-dashed border-line px-5 py-8 text-center font-mono text-xs text-muted">
          {filtering
            ? "// nenhum projeto nesse filtro — limpa pra ver o acervo todo"
            : "// nenhum projeto entregue ainda — o primeiro tá saindo do forno"}
        </p>
      )}
    </section>
  );
}
