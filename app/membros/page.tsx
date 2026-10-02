import Link from "next/link";
import type { Metadata } from "next";
import { listLeaderboard, type LeaderboardSort } from "@/lib/members";
import { XpBar } from "@/components/XpBar";
import { Avatar } from "@/components/Avatar";

// pódio usa os tokens de raridade — ouro lendário pro #1, acento sutil #2/#3
const PODIUM_ROW: Record<number, string> = {
  1: "border-lendario/60 bg-lendario/5",
  2: "border-epico/40",
  3: "border-raro/40",
};
const PODIUM_RANK: Record<number, string> = {
  1: "text-lendario",
  2: "text-epico",
  3: "text-raro",
};

export const metadata: Metadata = {
  title: "membros",
  description:
    "Quem tá na frente — leaderboard de XP, badges, skills e histórico de campanhas da comunidade HackaHub.",
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
  const members = listLeaderboard(mode, 100, q);
  const isXp = mode === "xp";

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
          {"// leaderboard"}
        </p>
        <h1 className="font-display text-4xl font-bold tracking-tight">
          Quem tá na frente
        </h1>
        <p className="max-w-xl text-lg text-muted">
          XP acumulado em inscrições, posts e presença nas edições. O topo é
          lendário — literalmente.
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
          className="w-full max-w-md border border-line bg-surface px-4 py-2.5 font-mono text-sm outline-none transition placeholder:text-muted focus:border-accent"
        />
        <button
          type="submit"
          className="border border-line px-4 py-2.5 font-mono text-sm text-muted transition hover:border-accent hover:text-accent"
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

      <ol className="flex flex-col gap-2">
        {members.map((m, i) => {
          const rank = i + 1;
          const podium = isXp ? PODIUM_ROW[rank] : undefined;
          const rankColor = (isXp && PODIUM_RANK[rank]) || "text-muted";
          return (
            <li
              key={m.username}
              data-rank={rank}
              className={`border bg-background transition hover:bg-surface ${podium ?? "border-line"}`}
            >
              <Link
                href={`/u/${m.username}`}
                aria-label={`#${rank} — @${m.username}`}
                className="group flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-6"
              >
                <span
                  className={`w-12 shrink-0 font-display text-xl font-bold ${rankColor}`}
                >
                  #{rank}
                </span>
                <Avatar
                  username={m.username}
                  name={m.name}
                  avatarUrl={m.avatarUrl}
                  size="md"
                />
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-display font-semibold tracking-tight transition group-hover:text-accent">
                      {m.name ?? `@${m.username}`}
                    </span>
                    <span className="font-mono text-xs text-muted">
                      @{m.username}
                    </span>
                    {m.persona && (
                      <span className="border border-accent/30 bg-accent/10 px-1.5 font-mono text-[10px] text-accent">
                        {m.persona}
                      </span>
                    )}
                  </span>
                  {m.headline && (
                    <span className="font-mono text-xs text-muted">
                      {m.headline}
                    </span>
                  )}
                  <span className="font-mono text-[10px] text-muted">
                    {m.badges ?? 0} badges · {m.campaigns ?? 0} camp. ·{" "}
                    {m.cards ?? 0} cards
                  </span>
                </span>
                <span className="w-full shrink-0 sm:w-60">
                  <XpBar xp={m.xp} />
                </span>
              </Link>
            </li>
          );
        })}
      </ol>

      {members.length === 0 && (
        <p className="border border-dashed border-line px-5 py-8 text-center font-mono text-xs text-muted">
          {q
            ? `// nenhum membro com "${q}"`
            : "// ainda vazio — cria tua conta e entra pro ranking"}
        </p>
      )}
    </section>
  );
}
