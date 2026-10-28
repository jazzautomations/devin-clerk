import Link from "next/link";
import { ReportResolve } from "@/components/ReportResolve";
import { formatDbTime } from "@/lib/format";
import { REPORT_TARGET_LABEL, type Report, type ReportTarget } from "@/lib/reports";

// Fila de denúncias (migration 032), a mesma peça no /admin, na comunidade e
// na edição. Mostra o texto denunciado (snapshot), o motivo, o link pro
// conteúdo e, no admin, pra onde a denúncia foi roteada. Nunca mostra quem
// denunciou.

type Props = {
  open: Report[];
  resolved: Report[];
  counts: Partial<Record<ReportTarget, number>>;
  /** tipo filtrado (?tipo=) */
  type: ReportTarget | null;
  /** endereço da página, pros links de filtro */
  basePath: string;
  /** âncora pra voltar ao lugar da fila depois do filtro */
  anchor?: string;
  showRouting?: boolean;
  empty: string;
};

export function ReportQueue({ open, resolved, counts, type, basePath, anchor = "", showRouting = false, empty }: Props) {
  const total = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);
  const types = (Object.keys(counts) as ReportTarget[]).filter((t) => (counts[t] ?? 0) > 0);
  const href = (t: ReportTarget | null) => `${basePath}${t ? `${basePath.includes("?") ? "&" : "?"}tipo=${t}` : ""}${anchor}`;

  return (
    <div className="flex flex-col gap-4" data-testid="report-queue">
      {types.length > 1 && (
        <nav aria-label="filtrar por tipo" className="flex flex-wrap gap-2">
          <Link href={href(null)} className={`chip bare ${type === null ? "bg-foreground! text-background!" : ""}`} aria-current={type === null ? "true" : undefined}>
            todas · {total}
          </Link>
          {types.map((t) => (
            <Link key={t} href={href(t)} className={`chip bare ${type === t ? "bg-foreground! text-background!" : ""}`} aria-current={type === t ? "true" : undefined}>
              {REPORT_TARGET_LABEL[t]} · {counts[t]}
            </Link>
          ))}
        </nav>
      )}

      {open.length === 0 ? (
        <p className="border-[1.5px] border-dashed border-line px-4 py-5 font-mono text-[13px] text-muted" data-testid="report-queue-empty">
          {empty}
        </p>
      ) : (
        <ul className="flex flex-col border-b border-line" data-testid="report-list">
          {open.map((r) => (
            <li key={r.id} className="flex flex-col gap-2.5 border-t border-line py-4" data-testid="report-item">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="flex flex-wrap items-baseline gap-2">
                  <span className="border border-orange px-1.5 font-mono text-[11px] text-orange uppercase">{REPORT_TARGET_LABEL[r.targetType]}</span>
                  <span className="font-bold break-words">{r.reason}</span>
                </span>
                <span className="font-mono text-[12px] text-muted">
                  #{r.id} · {formatDbTime(r.createdAt)}
                </span>
              </div>
              {r.snapshot && (
                <blockquote className="border-l-2 border-line bg-surface-hi/50 px-3 py-2 text-[14px] leading-relaxed break-words whitespace-pre-line [overflow-wrap:anywhere]">
                  {r.snapshot}
                </blockquote>
              )}
              <p className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[12px]">
                {r.href && (
                  <Link href={r.href} className="text-accent underline-offset-4 hover:underline">
                    ver onde está
                  </Link>
                )}
                {showRouting && (
                  <span className="text-muted" data-testid="report-routing">
                    vai pra {r.routedTo}
                  </span>
                )}
              </p>
              <ReportResolve id={r.id} />
            </li>
          ))}
        </ul>
      )}

      {resolved.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer list-none font-mono text-[12.5px] text-muted hover:text-foreground">
            resolvidas há pouco ({resolved.length}) <span className="group-open:hidden">▸</span>
            <span className="hidden group-open:inline">▾</span>
          </summary>
          <ul className="mt-2 flex flex-col border-b border-line-soft">
            {resolved.map((r) => (
              <li key={r.id} className="flex flex-col gap-0.5 border-t border-line-soft py-2 font-mono text-[12px]">
                <span className="break-words">
                  <span className="text-muted">{REPORT_TARGET_LABEL[r.targetType]} ·</span> {r.reason}
                </span>
                <span className="text-muted break-words">
                  {r.resolution ?? "resolvida"}
                  {r.resolvedByUsername ? ` · @${r.resolvedByUsername}` : ""}
                  {r.resolvedAt ? ` · ${formatDbTime(r.resolvedAt)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** ?tipo= da URL validado */
export function reportTypeParam(v: unknown): ReportTarget | null {
  return typeof v === "string" && Object.hasOwn(REPORT_TARGET_LABEL, v) ? (v as ReportTarget) : null;
}
