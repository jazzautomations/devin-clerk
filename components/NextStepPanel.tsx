import Link from "next/link";
import type { ReactNode } from "react";
import { JOURNEY, stageIndex, type NextStep } from "@/lib/nextStep";

// spec 039 — "teu próximo passo": trilho da jornada + o único passo que
// importa agora. tone "dark" no topo da página da edição; "paper" nos
// cards do /dashboard (um por edição ativa). Server component puro.
export function NextStepPanel({
  step,
  tone = "dark",
  heading,
  children,
}: {
  step: NextStep;
  tone?: "dark" | "paper";
  /** card do dashboard: nome da edição + data, linkado */
  heading?: { name: string; href: string; meta: string };
  children?: ReactNode;
}) {
  const dark = tone === "dark";
  const current = stageIndex(step.stage);
  const muted = dark ? "text-[#b8cdc0]" : "text-muted";
  const rule = dark ? "border-[#2a5f45]" : "border-line-soft";

  return (
    <section
      data-testid="next-step"
      data-step={step.key}
      aria-label="seu próximo passo"
      className={dark ? "border-2 border-line bg-foreground text-background" : "border-[1.5px] border-line bg-background"}
    >
      {heading && (
        <div className={`flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b ${rule} px-4 py-3 sm:px-5`}>
          <Link href={heading.href} className="min-w-0 text-[18px] leading-tight font-extrabold tracking-[-0.02em] hover:text-accent">
            {heading.name}
          </Link>
          <span className="font-mono text-[12px] text-muted">{heading.meta}</span>
        </div>
      )}

      {/* trilho: etapas com a atual marcada. No 390 vira barra + "etapa N de 6" */}
      <div className={`border-b ${rule} px-4 pt-3 pb-3 sm:px-5`}>
        <p className={`font-mono text-[12px] sm:hidden ${muted}`}>
          etapa {current + 1} de {JOURNEY.length} · <span className={dark ? "text-band" : "text-accent"}>{JOURNEY[current].label}</span>
        </p>
        <ol className="mt-2 grid grid-cols-6 gap-1 sm:mt-0 sm:gap-3" aria-label="etapas da edição">
          {JOURNEY.map((j, i) => {
            const done = i < current || (i === current && step.stageDone);
            const now = i === current;
            const bar = done
              ? dark
                ? "bg-band"
                : "bg-accent"
              : now
                ? dark
                  ? "bg-background"
                  : "bg-foreground"
                : dark
                  ? "bg-[#2f3b35]"
                  : "bg-chrome";
            return (
              <li key={j.key} aria-current={now ? "step" : undefined} className="flex min-w-0 flex-col gap-1.5">
                <span aria-hidden className={`block h-[3px] ${bar}`} />
                <span
                  className={`hidden truncate font-mono text-[11.5px] sm:block ${
                    now ? (dark ? "text-background" : "font-semibold text-foreground") : done ? (dark ? "text-band" : "text-accent") : muted
                  }`}
                >
                  {String(i + 1).padStart(2, "0")} {j.label}
                  <span className="sr-only">{done ? " (feito)" : now ? " (agora)" : ""}</span>
                </span>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="flex flex-col gap-4 px-4 py-5 sm:flex-row sm:items-end sm:justify-between sm:gap-8 sm:px-5 sm:py-6">
        <div className="min-w-0">
          <p className={`font-mono text-[12px] tracking-[0.06em] uppercase ${dark ? "text-band" : "text-accent"}`}>
            seu próximo passo
          </p>
          <p
            className={`mt-1.5 leading-[1.02] font-extrabold tracking-[-0.03em] ${
              heading ? "text-[clamp(1.35rem,3vw,1.75rem)]" : "text-[clamp(1.7rem,4vw,2.6rem)]"
            }`}
            data-testid="next-step-status"
          >
            {step.status}
          </p>
          {step.detail && (
            <p
              className={`mt-2 max-w-[56ch] text-[14.5px] leading-snug ${muted}`}
              data-testid={step.key === "ajudando" ? "register-blocked-helper" : undefined}
            >
              {step.detail}
            </p>
          )}
        </div>
        {step.action && (
          <div className="shrink-0">
            {step.action.external ? (
              <a
                href={step.action.href}
                target="_blank"
                rel="noopener"
                className={dark ? "btn-go w-full sm:w-auto" : "btn w-full sm:w-auto"}
              >
                {step.action.label} ↗
              </a>
            ) : (
              <Link href={step.action.href} className={dark ? "btn-go w-full sm:w-auto" : "btn w-full sm:w-auto"}>
                {step.action.label} →
              </Link>
            )}
          </div>
        )}
      </div>
      {children && <div className={`border-t ${rule} px-4 py-3 sm:px-5`}>{children}</div>}
    </section>
  );
}
