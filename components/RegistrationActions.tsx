"use client";

import { useState } from "react";

// Curadoria da fila "pedir lugar" (spec 032) — aprovar efetiva a inscrição
// e paga a recompensa (carta/XP/badges); recusar marca 'rejected'. Em
// 'rejected' só resta re-aprovar; a decisão é revisada server-side e o
// reload reflete a fila nova.
export function RegistrationActions({
  hackathonId,
  memberId,
  status,
}: {
  hackathonId: string;
  memberId: number;
  status: "pending" | "rejected";
}) {
  const [busy, setBusy] = useState<"" | "approve" | "reject">("");
  const [error, setError] = useState("");

  async function act(action: "approve" | "reject") {
    setBusy(action);
    setError("");
    const res = await fetch(
      `/api/admin/hackathons/${hackathonId}/registrations/${memberId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      },
    ).catch(() => null);
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
        className="font-mono text-[10px] text-accent uppercase tracking-widest transition hover:brightness-125 disabled:opacity-50"
      >
        {busy === "approve" ? "…" : "aprovar"}
      </button>
      {status === "pending" && (
        <button
          type="button"
          onClick={() => act("reject")}
          disabled={busy !== ""}
          className="font-mono text-[10px] text-muted uppercase tracking-widest transition hover:text-red-400 disabled:opacity-50"
        >
          {busy === "reject" ? "…" : "recusar"}
        </button>
      )}
      {error && (
        <span className="font-mono text-[10px] text-red-400">{error}</span>
      )}
    </span>
  );
}
