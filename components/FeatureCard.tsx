import type { Feature } from "@/app.config";

export function FeatureCard({
  feature,
  index,
}: {
  feature: Feature;
  index: number;
}) {
  return (
    <article className="group flex flex-col gap-3 border border-line bg-surface p-5 transition hover:border-accent/40">
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs text-accent">
          {String(index + 1).padStart(2, "0")}
        </span>
        <span className="font-mono text-[10px] tracking-widest text-muted uppercase">
          coming soon
        </span>
      </div>
      <h3 className="font-display text-lg font-semibold tracking-tight">
        {feature.title}
      </h3>
      <p className="text-sm leading-relaxed text-muted">
        {feature.description}
      </p>
    </article>
  );
}
