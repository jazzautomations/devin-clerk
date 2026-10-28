import Link from "next/link";
import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { getMemberByClerkId } from "@/lib/members";
import { listProjectEditions, listProjects, listTopTech, PROJECTS_PAGE_SIZE } from "@/lib/projects";
import { normalizeTech, techLabel } from "@/lib/techTags";

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: "projetos",
    description:
      "Todo time que entregou vira portfólio público — o índice de tudo que já nasceu nos hackathons da comunidade.",
    alternates: { canonical: "/projetos" },
    openGraph: { title: "projetos", type: "website" },
  };
}

function hrefFor(f: {
  h?: string;
  live?: boolean;
  q?: string;
  sort?: string;
  tech?: string;
  page?: number;
}): string {
  const params = new URLSearchParams();
  if (f.h) params.set("h", f.h);
  if (f.live) params.set("live", "1");
  if (f.q) params.set("q", f.q);
  if (f.sort === "votes") params.set("sort", "votes");
  if (f.tech) params.set("tech", f.tech);
  if (f.page && f.page > 1) params.set("pagina", String(f.page));
  const qs = params.toString();
  return qs ? `/projetos?${qs}` : "/projetos";
}

export default async function ProjetosPage({
  searchParams,
}: {
  searchParams: Promise<{
    h?: string;
    live?: string;
    q?: string;
    sort?: string;
    tech?: string;
    pagina?: string;
  }>;
}) {
  const { h, live, q: rawQ, sort, tech: rawTech, pagina } = await searchParams;
  const hackathonId = h?.trim() || undefined;
  const liveOnly = live === "1";
  const q = rawQ?.trim() ?? "";
  const sortVotes = sort === "votes"; // escolha do povo — spec 025
  // spec 046 — filtro por tecnologia (project_tech) e paginação real
  const tech = normalizeTech(rawTech) ?? "";
  const pageNum = Math.min(Math.max(1, Math.floor(Number(pagina)) || 1), 10_000);

  // member logado alimenta votedByMe nos cards (placar destaca o próprio voto)
  const { userId } = await auth();
  const member = userId ? await getMemberByClerkId(userId) : null;

  const [page, editions, topTech] = await Promise.all([
    // um a mais pra saber se existe a próxima página
    listProjects({
      hackathonId,
      liveOnly,
      q: q || undefined,
      sort: sortVotes ? "votes" : "jury",
      meId: member?.id ?? null,
      tech: tech || undefined,
      limit: PROJECTS_PAGE_SIZE + 1,
      offset: (pageNum - 1) * PROJECTS_PAGE_SIZE,
    }),
    listProjectEditions(),
    listTopTech(20),
  ]);
  const projects = page.slice(0, PROJECTS_PAGE_SIZE);
  const hasNext = page.length > PROJECTS_PAGE_SIZE;
  const hasPrev = pageNum > 1;
  const filtering = !!hackathonId || liveOnly || !!q || !!tech;
  const base = { h: hackathonId, live: liveOnly, q, sort, tech: tech || undefined };
  // a tag filtrada aparece nos chips mesmo fora das 20 mais usadas
  const techChips = tech && !topTech.some((t) => t.tag === tech) ? [{ tag: tech, count: 0 }, ...topTech] : topTech;

  const chip = (active: boolean) =>
    `border-[1.5px] px-3 py-1.5 transition ${
      active
        ? "border-line bg-foreground text-band"
        : "border-line text-foreground hover:bg-mint"
    }`;

  return (
    <section className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-16 sm:px-6">
      <div className="flex flex-col gap-3">
        <p className="tag self-start uppercase">
          {"projetos"}
        </p>
        <h1 className="font-display text-[clamp(2.4rem,6vw,3.75rem)] font-extrabold tracking-[-0.035em] leading-[0.95]">
          O que já nasceu aqui
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
          {sortVotes && <input type="hidden" name="sort" value="votes" />}
          {tech && <input type="hidden" name="tech" value={tech} />}
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="buscar projeto, time…"
            aria-label="buscar projetos"
            className="w-full max-w-md border-[1.5px] border-line bg-surface px-4 py-2.5 font-mono text-sm outline-none transition placeholder:text-muted focus:border-accent"
          />
          <button
            type="submit"
            className="border-[1.5px] border-line px-4 py-2.5 font-mono text-sm text-muted transition hover:border-accent hover:text-accent"
          >
            buscar
          </button>
        </form>
      </div>

      {editions.length > 0 && (
        <div className="flex flex-wrap gap-2 font-mono text-xs">
          <Link
            href={hrefFor({ ...base, h: undefined })}
            aria-current={!hackathonId ? "page" : undefined}
            className={chip(!hackathonId)}
          >
            todas as edições
          </Link>
          {editions.map((e) => (
            <Link
              key={e.id}
              href={hrefFor({ ...base, h: e.id })}
              aria-current={hackathonId === e.id ? "page" : undefined}
              className={chip(hackathonId === e.id)}
            >
              {e.name}
            </Link>
          ))}
          <Link
            href={hrefFor({ ...base, live: !liveOnly })}
            aria-current={liveOnly ? "page" : undefined}
            className={chip(liveOnly)}
          >
            só ao vivo
          </Link>
          <Link
            href={hrefFor({ ...base, sort: sortVotes ? undefined : "votes" })}
            aria-current={sortVotes ? "page" : undefined}
            className={chip(sortVotes)}
          >
            ▲ escolha do povo
          </Link>
        </div>
      )}

      {techChips.length > 0 && (
        <nav aria-label="filtrar por tecnologia" className="flex flex-col gap-2" data-testid="tech-filter">
          <p className="font-mono text-[12px] tracking-[0.06em] text-muted uppercase">feito com</p>
          <div className="flex flex-wrap gap-1.5 font-mono text-xs">
            {tech && (
              <Link href={hrefFor({ ...base, tech: undefined })} className={chip(false)}>
                qualquer tecnologia
              </Link>
            )}
            {techChips.map((t) => (
              <Link
                key={t.tag}
                href={hrefFor({ ...base, tech: tech === t.tag ? undefined : t.tag })}
                aria-current={tech === t.tag ? "page" : undefined}
                className={chip(tech === t.tag)}
              >
                {techLabel(t.tag)}
                {t.count > 0 && <span className="ml-1.5 opacity-60">{t.count}</span>}
              </Link>
            ))}
          </div>
        </nav>
      )}

      {projects.length > 0 ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {projects.map((c) => (
            <li
              key={c.teamId}
              className={`card flex flex-col gap-3 p-5 ${
                c.placement === 1 ? "border-lendario bg-lendario/10" : ""
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                {/* spec 030 — logo do projeto como thumb 32px; sem
                    logoUrl o card não renderiza img nenhuma */}
                {c.project.logoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element -- logo remoto do time; next/image exigiria remotePatterns só pra isso
                  <img
                    src={c.project.logoUrl}
                    alt=""
                    width={32}
                    height={32}
                    loading="lazy"
                    className="mt-0.5 h-8 w-8 shrink-0 border border-line object-cover"
                  />
                )}
                <Link
                  href={`/p/${c.teamId}`}
                  className="font-display text-lg font-extrabold tracking-[-0.035em] transition hover:text-accent"
                >
                  {c.project.title}
                </Link>
                {c.placement >= 1 && c.placement <= 3 && (
                  <span
                    className={`shrink-0 border px-2 py-1 font-mono text-xs ${
                      c.placement === 1
                        ? "border-lendario bg-lendario/10 text-lendario"
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

              {c.tech.length > 0 && (
                <ul className="flex flex-wrap gap-1.5" aria-label="feito com">
                  {c.tech.map((t) => (
                    <li key={t.tag}>
                      <Link
                        href={hrefFor({ ...base, tech: t.tag, page: undefined })}
                        className="tag transition hover:text-accent"
                      >
                        {t.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-auto flex flex-wrap items-center gap-3 font-mono text-xs">
                <span
                  title="escolha do povo — votos da comunidade"
                  aria-label={`${c.voteCount} votos da comunidade`}
                  className={c.votedByMe ? "text-accent" : "text-muted"}
                >
                  ▲ {c.voteCount}
                </span>
                {c.liveDeployId && (
                  <a
                    href={`/demo/${c.liveDeployId}/`}
                    className="border-[1.5px] border-accent bg-mint px-2 py-1 text-accent transition hover:bg-[#c3ebd5]"
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
        <p className="border-[1.5px] border-line px-5 py-8 text-center font-mono text-xs text-muted">
          {hasPrev
            ? "acabou a lista nessa página"
            : tech
              ? `nenhum projeto feito com ${techLabel(tech)} ainda`
              : filtering
                ? "nenhum projeto nesse filtro — limpa pra ver o acervo todo"
                : "nenhum projeto entregue ainda — o primeiro tá saindo do forno"}
        </p>
      )}

      {(hasPrev || hasNext) && (
        <nav aria-label="páginas" className="flex items-center justify-between gap-3 border-t border-line pt-5 font-mono text-sm">
          {hasPrev ? (
            <Link href={hrefFor({ ...base, page: pageNum - 1 })} rel="prev" className="transition hover:text-accent">
              ← anteriores
            </Link>
          ) : (
            <span />
          )}
          <span className="text-xs text-muted">página {pageNum}</span>
          {hasNext ? (
            <Link href={hrefFor({ ...base, page: pageNum + 1 })} rel="next" className="transition hover:text-accent">
              próximos →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </section>
  );
}
