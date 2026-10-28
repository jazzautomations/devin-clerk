"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { userMessage } from "@/lib/apiError";

// Resolver denúncia (migration 032): escolhe o que foi feito, nota opcional,
// PATCH /api/reports/[id]. A fila recarrega e a denúncia sai das abertas.

const OUTCOMES = ["tirei o conteúdo do ar", "conversei com a pessoa", "não vi problema"] as const;

export function ReportResolve({ id }: { id: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<string>("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!outcome) return setError("Escolha o que foi feito.");
    setBusy(true);
    setError(null);
    const extra = note.trim();
    const res = await fetch(`/api/reports/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolution: extra ? `${outcome}: ${extra}` : outcome }),
    }).catch(() => null);
    setBusy(false);
    if (!res) return setError("Sem conexão. Tente de novo.");
    if (!res.ok) return setError(userMessage(res, await res.json().catch(() => null), "Não deu certo. Tente de novo."));
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn-ghost min-h-[40px]! self-start rounded-[6px] px-3! text-[13px]!" data-testid={`resolve-${id}`}>
        resolver
      </button>
    );
  }
  return (
    <form onSubmit={send} className="flex flex-col gap-2.5 border-[1.5px] border-line p-3" data-testid={`resolve-form-${id}`}>
      <fieldset className="flex flex-wrap gap-2">
        <legend className="mb-1.5 font-mono text-[12px] text-muted">o que foi feito?</legend>
        {OUTCOMES.map((o) => (
          <label
            key={o}
            className={`flex min-h-[36px] cursor-pointer items-center gap-2 border-[1.5px] px-2.5 text-[13.5px] ${
              outcome === o ? "border-foreground bg-mint" : "border-line-soft hover:border-foreground"
            }`}
          >
            <input type="radio" name={`resolve-${id}`} value={o} checked={outcome === o} onChange={() => setOutcome(o)} className="accent-[var(--accent)]" />
            {o}
          </label>
        ))}
      </fieldset>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={200}
        placeholder="nota pra quem modera junto (opcional)"
        aria-label="nota da resolução"
        className="w-full min-w-0 rounded-[6px] border-[1.5px] border-line bg-background px-3 py-2 text-[14px] focus:border-accent focus:outline-none"
      />
      {error && (
        <p role="alert" className="font-mono text-[12.5px] text-orange">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className="btn min-h-[40px]! rounded-[6px] text-[14px]! disabled:opacity-60" data-testid={`resolve-send-${id}`}>
          {busy ? "salvando…" : "marcar resolvida"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="font-mono text-[13px] text-muted hover:underline">
          cancelar
        </button>
      </div>
    </form>
  );
}
