import { levelFor } from "@/lib/game";

const SEGMENTS = 24;

export function XpBar({ xp }: { xp: number }) {
  const { level, next, progress } = levelFor(xp);
  const filled = Math.round(progress * SEGMENTS);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between font-mono text-xs">
        <span className="text-foreground">
          <span className="text-accent">LV{level.n}</span>{" "}
          {level.name.toUpperCase()}
        </span>
        <span className="text-muted">
          {xp} xp{next ? ` / ${next.min}` : " — nível máximo"}
        </span>
      </div>
      <div
        className="flex gap-[3px]"
        role="progressbar"
        aria-valuenow={Math.round(progress * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="progresso de nível"
      >
        {Array.from({ length: SEGMENTS }, (_, i) => (
          <span
            key={i}
            className={`h-2.5 flex-1 ${i < filled ? "bg-accent" : "bg-line"}`}
          />
        ))}
      </div>
    </div>
  );
}
