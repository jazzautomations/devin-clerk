"use client";

import { useState } from "react";

// Curadoria da fila de indicações (spec 026) — aprovar publica a edição
// no radar (source='comunidade'); recusar só tira da fila. Revisão é
// terminal server-side; o reload reflete a fila nova.
export function SubmissionActions({ id }: { id: number }) {
  const [busy, setBusy] = useState<"" | "approve" | "reject">("");
  const [error, setError] = useState("");

  async function act(action: "approve" | "reject") {
    setBusy(action);
    setError("");
    const res = await fetch(`/api/admin/submissions/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    }).catch(() => null);
    if (res?.ok) {
      window.location.reload();
    } else {
      setBusy("");
      const data = await res?.json().catch(() => null);
      setError(typeof data?.error === "string" ? data.error : "falhou");
    }
  }

  return (
    <span className="flex shrink-0 items-baseline gap-3">
      <button
        type="button"
        onClick={() => act("approve")}
        disabled={busy !== ""}
        className="font-mono text-[12px] text-accent uppercase tracking-[0.06em] transition hover:brightness-125 disabled:opacity-50"
      >
        {busy === "approve" ? "…" : "aprovar"}
      </button>
      <button
        type="button"
        onClick={() => act("reject")}
        disabled={busy !== ""}
        className="font-mono text-[12px] text-muted uppercase tracking-[0.06em] transition hover:text-orange disabled:opacity-50"
      >
        {busy === "reject" ? "…" : "recusar"}
      </button>
      {error && (
        <span className="font-mono text-[12px] text-orange">{error}</span>
      )}
    </span>
  );
}
