"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { userMessage } from "@/lib/apiError";

// Quem criou o desafio escolhe 1º a 3º e publica (POST …/result). Uma vez
// só: depois de publicado o resultado não muda, por isso o confirm.

type Entry = { id: number; label: string; project: string | null };

const PLACES = [1, 2, 3] as const;

export function ResultForm({ challengeId, entries }: { challengeId: number; entries: Entry[] }) {
  const router = useRouter();
  const [picks, setPicks] = useState<Record<number, string>>({ 1: "", 2: "", 3: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const taken = (place: number) => new Set(PLACES.filter((p) => p !== place).map((p) => picks[p]).filter(Boolean));

  async function publish() {
    if (!window.confirm("Publicar o resultado? Depois de publicado ele não muda e cada participante é avisado.")) return;
    setBusy(true);
    setError(null);
    try {
      const places = PLACES.filter((p) => picks[p]).map((p) => ({ entryId: Number(picks[p]), place: p }));
      const res = await fetch(`/api/open-challenges/${challengeId}/result`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ places }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(userMessage(res, data, "Não deu pra publicar. Tente de novo."));
        return;
      }
      router.refresh();
    } catch {
      setError("Sem conexão. Tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="flex flex-col gap-4 border-[1.5px] border-line bg-mint p-5"
      data-testid="result-form"
      onSubmit={(e) => {
        e.preventDefault();
        void publish();
      }}
    >
      <p className="text-[15px] font-bold">O prazo acabou. Escolha os três primeiros e publique o resultado.</p>
      {PLACES.map((p) => (
        <label key={p} className="flex flex-col gap-1.5">
          <span className="font-mono text-[12px] tracking-[0.06em] text-muted uppercase">
            {p}º lugar{p > 1 ? " (opcional)" : ""}
          </span>
          <select
            className="w-full min-w-0 rounded-[6px] border-[1.5px] border-line bg-background px-3.5 py-2.5 text-[15px] focus:border-accent focus:outline-none"
            value={picks[p]}
            onChange={(e) => setPicks((o) => ({ ...o, [p]: e.target.value }))}
            data-testid={`result-place-${p}`}
          >
            <option value="">ninguém</option>
            {entries.map((e) => (
              <option key={e.id} value={e.id} disabled={taken(p).has(String(e.id))}>
                {e.label}
                {e.project ? ` · ${e.project}` : ""}
              </option>
            ))}
          </select>
        </label>
      ))}
      <button type="submit" className="btn self-start" disabled={busy || !picks[1]} data-testid="result-submit">
        publicar resultado
      </button>
      {error && (
        <p role="alert" className="font-mono text-[13px] text-orange" data-testid="result-msg">
          {error}
        </p>
      )}
    </form>
  );
}
