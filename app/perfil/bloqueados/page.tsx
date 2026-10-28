import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import { UndoSafetyButton } from "@/components/ProfileSafetyMenu";
import { listMySafety, type SafetyPerson } from "@/lib/blocks";
import { formatDbTime } from "@/lib/format";
import { currentMember } from "@/lib/session";

export const metadata: Metadata = { title: "bloqueados e silenciados", robots: { index: false } };

// Quem eu bloqueei e quem eu silenciei (migration 032), com "desfazer".
// Só a própria pessoa vê; ninguém da lista sabe que está nela.

function PersonList({ people, kind, empty }: { people: SafetyPerson[]; kind: "block" | "mute"; empty: string }) {
  if (people.length === 0) {
    return (
      <p className="border-[1.5px] border-dashed border-line px-4 py-5 font-mono text-[13px] text-muted" data-testid={`empty-${kind}`}>
        {empty}
      </p>
    );
  }
  return (
    <ul className="flex flex-col border-b border-line" data-testid={`list-${kind}`}>
      {people.map((p) => (
        <li key={p.id} className="flex items-center justify-between gap-3 border-t border-line py-3">
          <span className="flex min-w-0 items-center gap-3">
            <Avatar username={p.username} name={p.name} avatarUrl={p.avatarUrl} size="md" />
            <span className="flex min-w-0 flex-col">
              <Link href={`/u/${p.username}`} className="truncate font-bold hover:text-accent">
                {p.name ?? `@${p.username}`}
              </Link>
              <span className="truncate font-mono text-[12px] text-muted">
                @{p.username} · desde {formatDbTime(p.createdAt)}
              </span>
            </span>
          </span>
          <UndoSafetyButton username={p.username} kind={kind} />
        </li>
      ))}
    </ul>
  );
}

export default async function BloqueadosPage() {
  const me = await currentMember();
  if (!me) notFound();
  const { blocked, muted } = await listMySafety(me.id);

  return (
    <section className="mx-auto flex w-full max-w-3xl flex-col gap-10 overflow-x-clip px-4 py-12 sm:px-6 sm:py-16" data-testid="safety-page">
      <header className="flex flex-col gap-3 border-b-2 border-line pb-6">
        <Link href="/perfil" className="font-mono text-[13px] text-accent underline-offset-4 hover:underline">
          ← perfil
        </Link>
        <h1 className="text-[clamp(2rem,6vw,3rem)] leading-[0.95] font-extrabold tracking-[-0.04em]">Bloqueados e silenciados</h1>
        <p className="max-w-[60ch] text-[15px] text-muted">
          Ninguém daqui sabe que está na lista. Desfazer também não avisa ninguém.
        </p>
      </header>

      <section aria-labelledby="bloqueados-title" className="flex flex-col gap-3">
        <h2 id="bloqueados-title" className="text-[clamp(1.4rem,2.6vw,1.7rem)] leading-none font-extrabold tracking-[-0.03em]">
          Bloqueados <span className="font-mono text-[15px] font-normal text-muted">{blocked.length}</span>
        </h2>
        <p className="text-[14px] text-muted">Vocês não se veem: perfil, posts e notificações somem pros dois lados.</p>
        <PersonList people={blocked} kind="block" empty="Você não bloqueou ninguém." />
      </section>

      <section aria-labelledby="silenciados-title" className="flex flex-col gap-3">
        <h2 id="silenciados-title" className="text-[clamp(1.4rem,2.6vw,1.7rem)] leading-none font-extrabold tracking-[-0.03em]">
          Silenciados <span className="font-mono text-[15px] font-normal text-muted">{muted.length}</span>
        </h2>
        <p className="text-[14px] text-muted">Os posts e as notificações dessa pessoa somem só pra você.</p>
        <PersonList people={muted} kind="mute" empty="Você não silenciou ninguém." />
      </section>
    </section>
  );
}
