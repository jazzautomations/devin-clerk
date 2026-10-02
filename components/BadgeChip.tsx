import type { Badge } from "@/lib/game";

export function BadgeChip({ badge }: { badge: Badge }) {
  return (
    <span
      title={badge.desc}
      className="inline-flex items-center gap-1.5 border border-line bg-surface px-2.5 py-1 font-mono text-[10px] text-foreground"
    >
      <span className="text-accent">{badge.glyph}</span>
      {badge.name}
    </span>
  );
}
