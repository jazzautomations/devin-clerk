import Link from "next/link";
import type { Metadata } from "next";
import { listLeaderboard, type LeaderboardSort } from "@/lib/members";
import { XpBar } from "@/components/XpBar";
import { Avatar } from "@/components/Avatar";
import { FollowButton } from "@/components/FollowButton";
import { hiddenIdsFor } from "@/lib/blocks";
import { followingIds } from "@/lib/memberFollows";
import { currentMember } from "@/lib/session";

export const metadata: Metadata = {
  title: "membros",
  description:
    "Quem constrói no HackaHub: skills, conquistas e campanhas de cada pessoa.",
  alternates: { canonical: "/membros" },
};

export default async function MembrosPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; q?: string }>;
}) {
  const { sort, q: rawQ } = await searchParams;
  const q = rawQ?.trim() ?? "";
  const mode: LeaderboardSort = sort === "recent" ? "recent" : "xp";
  const me = await currentMember();
  const [all, hidden, mine] = await Promise.all([
    listLeaderboard(mode, 100, q),
    me ? hiddenIdsFor(me.id) : null,
    me ? followingIds(me.id) : [],
  ]);
  // bloqueio (dois sentidos) e silêncio somem da lista, conta excluída também
  const out = new Set([...(hidden?.blocked ?? []), ...(hidden?.muted ?? [])]);
  const members = all.filter((m) => !out.has(m.id) && !m.clerkId.startsWith("deleted:"));
  const followed = new Set(mine);
  const isXp = mode === "xp";

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

      <form action="/membros" className="flex gap-2">
        {!isXp && <input type="hidden" name="sort" value="recent" />}
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="username, nome, skill…"
          aria-label="buscar membros"
          className="w-full max-w-md border-[1.5px] border-line bg-surface px-4 py-2.5 font-mono text-sm outline-none transition placeholder:text-muted focus:border-accent"
        />
        <button
          type="submit"
          className="border-[1.5px] border-line px-4 py-2.5 font-mono text-sm text-muted transition hover:border-accent hover:text-accent"
        >
          buscar
        </button>
      </form>

      <div className="flex gap-2 font-mono text-xs">
        <Link
          href={q ? `/membros?q=${encodeURIComponent(q)}` : "/membros"}
          aria-current={isXp ? "page" : undefined}
          className={chip(isXp)}
        >
          por xp
        </Link>
        <Link
          href={
            q
              ? `/membros?sort=recent&q=${encodeURIComponent(q)}`
              : "/membros?sort=recent"
          }
          aria-current={!isXp ? "page" : undefined}
          className={chip(!isXp)}
        >
          recém-chegados
        </Link>
      </div>

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
                  <span className="font-mono text-[12px] text-muted">
                    {m.badges ?? 0} badges · {m.campaigns ?? 0} camp. ·{" "}
                    {m.cards ?? 0} cards
                  </span>
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
            : "Ninguém por aqui ainda."}
        </p>
      )}
    </section>
  );
}
