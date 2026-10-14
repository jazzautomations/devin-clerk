import type { Feature } from "@/app.config";

export function FeatureCard({
  feature,
  index,
}: {
  feature: Feature;
  index: number;
}) {
  return (
    <article className="group flex flex-col gap-3 border border-line bg-surface p-5 transition hover:border-line">
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs text-accent">
          {String(index + 1).padStart(2, "0")}
        </span>
        <span className="font-mono text-[12px] tracking-[0.06em] text-muted uppercase">
          coming soon
        </span>
      </div>
      <h3 className="font-display text-lg font-extrabold tracking-[-0.035em]">
        {feature.title}
      </h3>
      <p className="text-sm leading-relaxed text-muted">
        {feature.description}
      </p>
    </article>
  );
}
