"use client";

import { useState } from "react";
import { userMessage } from "@/lib/apiError";

// Voto pra cima e pra baixo (tópicos da comunidade, migration 058). Clicar
// na seta marcada desfaz; clicar na outra troca. Otimista: muda na hora e
// volta se a API recusar. Sem permissão (não é membro ou é o autor) mostra
// só o placar, com o motivo no title.

type Vote = -1 | 0 | 1;

export function VoteButtons({
  endpoint,
  score: initialScore,
  myVote: initialVote,
  disabledReason = null,
  orientation = "vertical",
  label = "tópico",
}: {
  /** POST {value} → {score, myVote} */
  endpoint: string;
  score: number;
  myVote: Vote;
  /** null = pode votar; texto = por que não pode */
  disabledReason?: string | null;
  orientation?: "vertical" | "horizontal";
  /** "tópico" ou "resposta": entra no aria-label */
  label?: string;
}) {
  const [score, setScore] = useState(initialScore);
  const [vote, setVote] = useState<Vote>(initialVote);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const disabled = disabledReason !== null;

  async function cast(dir: 1 | -1) {
    if (disabled || busy) return;
    const next: Vote = vote === dir ? 0 : dir;
    const prev = { score, vote };
    setScore(score - vote + next);
    setVote(next);
    setBusy(true);
    setError(null);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: next }),
    }).catch(() => null);
    setBusy(false);
    const data = res ? await res.json().catch(() => null) : null;
    if (!res || !res.ok) {
      setScore(prev.score);
      setVote(prev.vote);
      setError(res ? userMessage(res, data, "Não deu pra votar.") : "Sem conexão.");
      return;
    }
    setScore(Number(data.score));
    setVote(data.myVote as Vote);
  }

  const vertical = orientation === "vertical";
  const btn = (dir: 1 | -1) => {
    const on = vote === dir;
    const tone = on ? (dir === 1 ? "bg-mint text-accent border-accent" : "bg-[#fbe7e1] text-orange border-orange") : "border-transparent text-muted";
    return (
      <button
        type="button"
        onClick={() => cast(dir)}
        disabled={disabled || busy}
        aria-pressed={on}
        aria-label={`${dir === 1 ? "votar a favor" : "votar contra"} d${label === "resposta" ? "a" : "o"} ${label}`}
        title={disabledReason ?? (on ? "desfazer voto" : undefined)}
        data-testid={dir === 1 ? "vote-up" : "vote-down"}
        className={`flex h-8 w-8 shrink-0 items-center justify-center border-[1.5px] transition ${tone} ${
          disabled ? "cursor-default opacity-35" : "hover:border-foreground hover:text-foreground"
        }`}
      >
        <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" className={dir === -1 ? "rotate-180" : ""}>
          <path d="M6 2 11 9H1z" fill="currentColor" />
        </svg>
      </button>
    );
  };

  return (
    <div className={`relative flex shrink-0 items-center ${vertical ? "flex-col gap-0.5" : "flex-row gap-1"}`} data-testid="vote-buttons">
      {btn(1)}
      <span
        className={`min-w-[2ch] text-center font-mono text-[13px] font-bold tabular-nums ${vote === 1 ? "text-accent" : vote === -1 ? "text-orange" : ""}`}
        data-testid="vote-score"
        aria-live="polite"
      >
        {score}
      </span>
      {btn(-1)}
      {error && (
        <span role="alert" className="absolute top-full left-0 z-10 mt-1 w-max max-w-[220px] border-[1.5px] border-orange bg-background px-2 py-1 font-mono text-[11px] text-orange">
          {error}
        </span>
      )}
    </div>
  );
}
