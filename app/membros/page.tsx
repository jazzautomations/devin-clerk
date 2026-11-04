import Link from "next/link";
import type { Metadata } from "next";
import { listLeaderboard, type LeaderboardSort } from "@/lib/members";
import { XpBar } from "@/components/XpBar";
import { Avatar } from "@/components/Avatar";
import { FollowButton } from "@/components/FollowButton";
import { MemberFilters } from "@/components/MemberFilters";
import { hiddenIdsFor } from "@/lib/blocks";
import { followingIds } from "@/lib/memberFollows";
import { currentMember } from "@/lib/session";
import { areaLabel, isAreaKey } from "@/lib/areas";

export const metadata: Metadata = {
  title: "membros",
  description:
    "Quem constrói no HackaHub: skills, conquistas e campanhas de cada pessoa.",
  alternates: { canonical: "/membros" },
};

/** filtro só vale com valor conhecido: lixo na URL não vira SQL */
const areaParam = (v: string | undefined) => (isAreaKey(v) ? v : undefined);
const textParam = (v: string | undefined) => v?.trim() || undefined;

export default async function MembrosPage({
  searchParams,
}: {
  searchParams: Promise<{
    sort?: string;
    q?: string;
    oferece?: string;
    quer?: string;
    cidade?: string;
    faculdade?: string;
  }>;
}) {
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const mode: LeaderboardSort = sp.sort === "recent" ? "recent" : "xp";
  const filter = {
    oferece: areaParam(sp.oferece),
    quer: areaParam(sp.quer),
    cidade: textParam(sp.cidade),
    faculdade: textParam(sp.faculdade),
  };
  const me = await currentMember();
  const [all, hidden, mine] = await Promise.all([
    listLeaderboard(mode, 100, q, filter),
    me ? hiddenIdsFor(me.id) : null,
    me ? followingIds(me.id) : [],
  ]);
  // bloqueio (dois sentidos) e silêncio somem da lista, conta excluída também
  const out = new Set([...(hidden?.blocked ?? []), ...(hidden?.muted ?? [])]);
  const members = all.filter((m) => !out.has(m.id) && !m.clerkId.startsWith("deleted:"));
  const followed = new Set(mine);
  const isXp = mode === "xp";

  // os chips de ordenar mantêm os filtros da URL
  const keep = new URLSearchParams();
  if (q) keep.set("q", q);
  for (const [k, v] of Object.entries(filter)) if (v) keep.set(k, v);
  const sortHref = (next?: "recent") => {
    const params = new URLSearchParams(keep);
    if (next) params.set("sort", next);
    const s = params.toString();
    return s ? `/membros?${s}` : "/membros";
  };

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
          {"membros"}
        </p>
        <h1 className="font-display text-[clamp(2.4rem,6vw,3.75rem)] font-extrabold tracking-[-0.035em] leading-[0.95]">
          Quem constrói aqui
        </h1>
        <p className="max-w-xl text-lg text-muted">
          Todo mundo que está no HackaHub. Siga quem você quer acompanhar.
        </p>
      </div>

      <MemberFilters
        action="/membros"
        values={{ q, ...filter }}
        sort={isXp ? undefined : "recent"}
        searchLabel="buscar membros"
      />

      <div className="flex gap-2 font-mono text-xs">
        <Link href={sortHref()} aria-current={isXp ? "page" : undefined} className={chip(isXp)}>
          por xp
        </Link>
        <Link href={sortHref("recent")} aria-current={!isXp ? "page" : undefined} className={chip(!isXp)}>
          recém-chegados
        </Link>
      </div>

      {(filter.oferece || filter.quer) && (
        <p className="font-mono text-[12px] text-muted" data-testid="filtro-area">
          {filter.oferece ? `oferece ${areaLabel(filter.oferece)}` : ""}
          {filter.oferece && filter.quer ? " · " : ""}
          {filter.quer ? `quer ${areaLabel(filter.quer)}` : ""}
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {members.map((m) => (
          <li
            key={m.username}
            data-member={m.username}
            className="flex flex-col gap-3 border border-line bg-background p-4 transition hover:bg-surface sm:flex-row sm:items-center sm:gap-6"
          >
            <Link
              href={`/u/${m.username}`}
              aria-label={`@${m.username}`}
              className="group flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-center sm:gap-6"
            >
              <span className="flex min-w-0 flex-1 items-start gap-3">
                <Avatar
                  username={m.username}
                  name={m.name}
                  avatarUrl={m.avatarUrl}
                  size="md"
                />
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-display font-extrabold tracking-[-0.035em] transition [overflow-wrap:anywhere] group-hover:text-accent">
                      {m.name ?? `@${m.username}`}
                    </span>
                    <span className="font-mono text-xs text-muted">
                      @{m.username}
                    </span>
                    {m.persona && (
                      <span className="border border-line bg-mint px-1.5 font-mono text-[12px] text-accent">
                        {m.persona}
                      </span>
                    )}
                  </span>
                  {m.headline && (
                    <span className="font-mono text-xs text-muted [overflow-wrap:anywhere]">
                      {m.headline}
                    </span>
                  )}
                  {(m.city || m.institution) && (
                    <span className="font-mono text-[12px] text-muted [overflow-wrap:anywhere]">
                      {[m.city, m.institution].filter(Boolean).join(" · ")}
                    </span>
                  )}
                  <span className="font-mono text-[12px] text-muted">
                    {m.badges ?? 0} badges · {m.campaigns ?? 0} camp. ·{" "}
                    {m.cards ?? 0} cards
                  </span>
                  {((m.helpOffer ?? []).length > 0 || (m.helpWant ?? []).length > 0) && (
                    <span className="flex flex-wrap gap-1">
                      {(m.helpOffer ?? []).map((k) => (
                        <span key={`o-${k}`} className="border border-line bg-mint px-1.5 font-mono text-[11px] text-accent">
                          ajuda em {areaLabel(k)}
                        </span>
                      ))}
                      {(m.helpWant ?? []).map((k) => (
                        <span key={`w-${k}`} className="border border-line px-1.5 font-mono text-[11px] text-muted">
                          quer ajuda em {areaLabel(k)}
                        </span>
                      ))}
                    </span>
                  )}
                </span>
              </span>
              <span className="w-full shrink-0 sm:w-52">
                <XpBar xp={m.xp} />
              </span>
            </Link>
            {me && me.id !== m.id && (
              <FollowButton
                username={m.username}
                following={followed.has(m.id)}
                compact
                className="shrink-0"
              />
            )}
          </li>
        ))}
      </ul>

      {members.length === 0 && (
        <p className="border-[1.5px] border-line px-5 py-8 text-center font-mono text-xs text-muted">
          {q
            ? `nenhum membro com "${q}"`
            : filter.oferece || filter.quer || filter.cidade || filter.faculdade
              ? "Ninguém com esses filtros ainda."
              : "Ninguém por aqui ainda."}
        </p>
      )}
    </section>
  );
}
