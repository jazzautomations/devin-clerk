import Link from "next/link";
import { levelFor } from "@/lib/game";
import { ligaEnabled } from "@/lib/league";
import type { XpFact } from "@/lib/xp";

const SEGMENTS = 24;

/**
 * Barra de nível. Com `facts` (de computeXp em lib/xp.ts) mostra "de onde
 * vem" expansível; `own` troca a copy pra segunda pessoa (painel e o próprio
 * perfil). Sem `facts` (listas como /membros) fica só a barra.
 */
export function XpBar({ xp, facts, own = false }: { xp: number; facts?: XpFact[]; own?: boolean }) {
  const { level, next, progress } = levelFor(xp);
  const filled = Math.round(progress * SEGMENTS);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3 font-mono text-xs">
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
      {facts && facts.length > 0 && (
        <details className="group font-mono text-xs" data-testid="xp-origem">
          <summary className="flex cursor-pointer list-none items-baseline gap-2 text-muted transition hover:text-accent [&::-webkit-details-marker]:hidden">
            <span className="shrink-0 text-accent">
              <span className="inline-block transition group-open:rotate-90" aria-hidden="true">
                ›
              </span>{" "}
              de onde vem
            </span>
            <span className="min-w-0 break-words">{facts.map((f) => f.label).join(" · ")}</span>
          </summary>
          <ul className="mt-2 flex flex-col border-t border-line">
            {facts.map((f) => (
              <li key={f.kind} className="flex items-baseline justify-between gap-3 border-b border-line py-1.5">
                <span className="min-w-0 text-foreground">{f.label}</span>
                <span className="shrink-0 text-muted">{f.xp} xp</span>
              </li>
            ))}
          </ul>
          {own && <p className="mt-2 text-muted">Seu nível sobe com o que você entrega nos hackathons.</p>}
        </details>
      )}
      {facts && facts.length === 0 && own && (
        <p className="font-mono text-xs text-muted" data-testid="xp-origem-vazio">
          Seu primeiro fato conta quando você fizer check-in num hackathon.
        </p>
      )}
      {own && ligaEnabled() && (
        // spec 046 onda 5 (migration 054): a porta da liga. Desligada por
        // flag, o link não aparece e /liga dá 404.
        <Link
          href="/liga"
          className="font-mono text-xs text-accent underline underline-offset-4"
          data-testid="xp-liga-link"
        >
          ver sua faixa na liga →
        </Link>
      )}
    </div>
  );
}
