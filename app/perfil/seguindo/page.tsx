import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FollowEmpty, FollowPeopleList, FollowTabs, MorePeople } from "@/components/FollowPeople";
import { listFollowing, ownCounts, teammatesToFollow } from "@/lib/memberFollows";
import { currentMember } from "@/lib/session";

export const metadata: Metadata = { title: "seguindo", robots: { index: false } };

// Quem você segue (migration 033). Vazio, sugere quem fez time com você.

export default async function SeguindoPage({ searchParams }: { searchParams: Promise<{ antes?: string }> }) {
  const me = await currentMember();
  if (!me) notFound();
  const { antes } = await searchParams;
  const [page, counts] = await Promise.all([listFollowing(me.id, antes ?? null), ownCounts(me.id)]);
  const firstEmpty = page.people.length === 0 && !antes;
  const teammates = firstEmpty ? await teammatesToFollow(me.id, 6) : [];

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-8 overflow-x-clip px-4 py-12 sm:px-6 sm:py-16" data-testid="following-page">
      <header className="flex flex-col gap-3 border-b-2 border-line pb-6">
        <Link href={`/u/${me.username}`} className="font-mono text-[13px] text-accent underline-offset-4 hover:underline">
          ← seu perfil
        </Link>
        <h1 className="text-[clamp(2rem,6vw,3rem)] leading-[0.95] font-extrabold tracking-[-0.04em]">Seguindo</h1>
        <p className="max-w-[60ch] text-[15px] text-muted">Quem você acompanha. Deixar de seguir não avisa ninguém.</p>
        <FollowTabs active="seguindo" counts={counts} />
      </header>

      {firstEmpty ? (
        <div className="flex flex-col gap-5">
          <FollowEmpty text="Você ainda não segue ninguém. Comece por quem fez time com você." testId="following-empty" />
          {teammates.length > 0 ? (
            <section aria-labelledby="time-title" className="flex flex-col gap-3">
              <h2 id="time-title" className="font-mono text-xs tracking-[0.06em] text-muted uppercase">
                fizeram time com você
              </h2>
              <FollowPeopleList people={teammates} testId="following-teammates" />
            </section>
          ) : (
            <Link href="/membros" className="btn-ghost self-start rounded-[6px]">
              ver quem está no HackaHub →
            </Link>
          )}
        </div>
      ) : page.people.length === 0 ? (
        <FollowEmpty text="Acabou a lista." testId="following-end" />
      ) : (
        <FollowPeopleList people={page.people} testId="following-list" />
      )}
      {page.next && <MorePeople href={`/perfil/seguindo?antes=${page.next}`} />}
    </section>
  );
}
