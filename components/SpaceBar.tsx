import Link from "next/link";
import type { CommunitySpace } from "@/lib/communitySpaces";

// Barra de espaços do mural da comunidade (migration 057): um chip por
// espaço ativo, na ordem que dono/organizador deixou. Os chips rolam na
// horizontal DENTRO da barra quando não cabem — a página não ganha scroll.
// Pra quem organiza, o link "espaços" abre a gestão (/comunidade/x/espacos).

export function SpaceBar({
  slug,
  spaces,
  active,
  canManage = false,
}: {
  slug: string;
  spaces: Pick<CommunitySpace, "slug" | "name">[];
  /** slug do espaço aberto (na página da comunidade é o geral) */
  active: string;
  canManage?: boolean;
}) {
  return (
    <nav aria-label="espaços da comunidade" className="overflow-x-auto" data-testid="space-bar">
      <ul className="flex w-max items-center gap-2">
        {spaces.map((s) => (
          <li key={s.slug}>
            <Link
              href={`/comunidade/${slug}/s/${s.slug}`}
              aria-current={s.slug === active ? "true" : undefined}
              className={`chip inline-block whitespace-nowrap ${s.slug === active ? "bg-foreground! text-background!" : "hover:bg-mint"}`}
              data-testid={`space-chip-${s.slug}`}
            >
              #{s.slug}
            </Link>
          </li>
        ))}
        {canManage && (
          <li>
            <Link
              href={`/comunidade/${slug}/espacos`}
              className="chip inline-block whitespace-nowrap border-dashed! text-muted hover:text-accent"
              data-testid="space-manage"
            >
              gerir espaços
            </Link>
          </li>
        )}
      </ul>
    </nav>
  );
}
