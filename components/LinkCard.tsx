import Link from "next/link";
import type { LinkCard as LinkCardData, LinkCardKind } from "@/lib/linkCard";

// Card do link interno do post (lib/linkCard.ts): projeto, edição, perfil
// ou comunidade do próprio HackaHub. Link externo não passa por aqui.

const KIND_LABEL: Record<LinkCardKind, string> = {
  projeto: "projeto",
  edicao: "edição",
  perfil: "perfil",
  comunidade: "comunidade",
};

export function LinkCard({ card }: { card: LinkCardData }) {
  return (
    <Link
      href={card.href}
      data-testid="link-card"
      data-kind={card.kind}
      className="group flex min-w-0 items-stretch border-[1.5px] border-line bg-background transition hover:bg-mint"
    >
      <span className="flex shrink-0 items-center border-r-[1.5px] border-line bg-foreground px-2.5 font-mono text-[11px] tracking-[0.06em] text-band uppercase">
        {KIND_LABEL[card.kind]}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 px-3 py-2">
        <span className="truncate text-[15px] leading-snug font-bold group-hover:text-accent">{card.title}</span>
        {card.subtitle && <span className="truncate font-mono text-[12px] text-muted">{card.subtitle}</span>}
      </span>
      <span aria-hidden className="flex shrink-0 items-center px-3 font-mono text-[13px] text-muted group-hover:text-accent">
        →
      </span>
    </Link>
  );
}
