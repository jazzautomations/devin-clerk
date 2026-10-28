import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FollowEmpty, FollowPeopleList, FollowTabs, MorePeople } from "@/components/FollowPeople";
import { listFollowers, ownCounts } from "@/lib/memberFollows";
import { currentMember } from "@/lib/session";

export const metadata: Metadata = { title: "seguidores", robots: { index: false } };

// Quem segue você (migration 033). Só você vê esta lista e esse número.

export default async function SeguidoresPage({ searchParams }: { searchParams: Promise<{ antes?: string }> }) {
  const me = await currentMember();
  if (!me) notFound();
  const { antes } = await searchParams;
  const [page, counts] = await Promise.all([listFollowers(me.id, antes ?? null), ownCounts(me.id)]);

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-8 overflow-x-clip px-4 py-12 sm:px-6 sm:py-16" data-testid="followers-page">
      <header className="flex flex-col gap-3 border-b-2 border-line pb-6">
        <Link href={`/u/${me.username}`} className="font-mono text-[13px] text-accent underline-offset-4 hover:underline">
          ← seu perfil
        </Link>
        <h1 className="text-[clamp(2rem,6vw,3rem)] leading-[0.95] font-extrabold tracking-[-0.04em]">Seguidores</h1>
        <p className="max-w-[60ch] text-[15px] text-muted">Só você vê quem te segue. No seu perfil, ninguém vê esse número.</p>
        <FollowTabs active="seguidores" counts={counts} />
      </header>

      {page.people.length === 0 ? (
        antes ? (
          <FollowEmpty text="Acabou a lista." testId="followers-end" />
        ) : (
          <FollowEmpty text="Ninguém segue você ainda." testId="followers-empty" />
        )
      ) : (
        <FollowPeopleList people={page.people} testId="followers-list" />
      )}
      {page.next && <MorePeople href={`/perfil/seguidores?antes=${page.next}`} />}
    </section>
  );
}
