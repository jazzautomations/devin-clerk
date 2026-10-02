"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// escolha do povo (spec 025): ▲/△ + contagem, toggle otimista — reflete na
// hora e reverte se o servidor negar. Anon vai pro sign-in; integrante do
// próprio time vê o placar desabilitado (voto é da comunidade, não auto).
export function VoteButton({
  teamId,
  initialCount,
  initialVoted,
  loggedIn,
  own,
}: {
  teamId: number;
  initialCount: number;
  initialVoted: boolean;
  loggedIn: boolean;
  own: boolean;
}) {
  const router = useRouter();
  const [voted, setVoted] = useState(initialVoted);
  const [count, setCount] = useState(initialCount);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (pending || own) return;
    if (!loggedIn) {
      router.push("/sign-in");
      return;
    }
    const next = !voted;
    setVoted(next);
    setCount((c) => c + (next ? 1 : -1));
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${teamId}/vote`, {
        method: "POST",
      });
      if (res.status === 401) {
        router.push("/sign-in");
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setVoted(Boolean(data.voted));
        setCount(Number(data.count ?? 0));
      } else {
        setVoted(!next);
        setCount((c) => c + (next ? -1 : 1));
        setError(
          typeof data.error === "string"
            ? data.error
            : "deu ruim — tenta de novo",
        );
      }
    } catch {
      setVoted(!next);
      setCount((c) => c + (next ? -1 : 1));
      setError("sem conexão — tenta de novo");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={toggle}
        disabled={pending || own}
        aria-pressed={voted}
        title={
          own
            ? "não dá pra votar no teu próprio time"
            : "escolha do povo — vota a comunidade"
        }
        className={`w-fit border px-4 py-2 font-mono text-sm transition disabled:opacity-60 ${
          voted
            ? "border-accent/50 bg-accent/10 text-accent"
            : "border-line text-muted hover:border-accent/50 hover:text-accent"
        }`}
      >
        {voted ? "▲" : "△"} {count} · escolha do povo
      </button>
      {own && (
        <p className="font-mono text-xs text-muted">
          {"// teu time — o voto é da comunidade, não tua"}
        </p>
      )}
      {error && <p className="font-mono text-xs text-red-400">{error}</p>}
    </div>
  );
}
