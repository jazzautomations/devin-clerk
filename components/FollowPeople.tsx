import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { FollowButton } from "@/components/FollowButton";
import type { FollowPerson } from "@/lib/memberFollows";

// Listas de /perfil/seguidores e /perfil/seguindo (migration 033). Só o dono
// vê. Cada linha leva ao /u da pessoa e tem o botão de seguir.

export function FollowTabs({ active, counts }: { active: "seguidores" | "seguindo"; counts: { seguidores: number; seguindo: number } }) {
  const tab = (key: "seguidores" | "seguindo", label: string) => (
    <Link
      href={`/perfil/${key}`}
      aria-current={active === key ? "page" : undefined}
      className={`flex min-h-[44px] items-center gap-2 border-[1.5px] px-3.5 font-mono text-[13px] transition ${
        active === key ? "border-line bg-foreground text-band" : "border-line text-foreground hover:bg-mint"
      }`}
    >
      {label}
      <span className={active === key ? "text-band" : "text-muted"}>{counts[key]}</span>
    </Link>
  );
  return (
    <nav aria-label="seguir" className="flex flex-wrap gap-2">
      {tab("seguidores", "seguidores")}
      {tab("seguindo", "seguindo")}
    </nav>
  );
}

export function FollowPeopleList({ people, testId }: { people: FollowPerson[]; testId: string }) {
  return (
    <ul className="flex flex-col border-b border-line" data-testid={testId}>
      {people.map((p) => (
        <li key={p.id} className="flex flex-col gap-3 border-t border-line py-4 sm:flex-row sm:items-center sm:justify-between">
          <Link href={`/u/${p.username}`} className="group flex min-w-0 items-center gap-3">
            <Avatar username={p.username} name={p.name} avatarUrl={p.avatarUrl} size="md" />
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-bold transition group-hover:text-accent">{p.name ?? `@${p.username}`}</span>
              <span className="truncate font-mono text-[12px] text-muted">@{p.username}</span>
              {p.headline && <span className="line-clamp-2 text-[14px] text-muted [overflow-wrap:anywhere]">{p.headline}</span>}
            </span>
          </Link>
          <FollowButton username={p.username} following={p.followedByMe} compact className="shrink-0" />
        </li>
      ))}
    </ul>
  );
}

export function FollowEmpty({ text, testId }: { text: string; testId: string }) {
  return (
    <p className="border-[1.5px] border-dashed border-line px-4 py-6 font-mono text-[13px] text-muted" data-testid={testId}>
      {text}
    </p>
  );
}

export function MorePeople({ href }: { href: string }) {
  return (
    <Link href={href} className="btn-ghost self-start rounded-[6px] font-mono text-[14px]!" data-testid="follow-more">
      mais
    </Link>
  );
}
