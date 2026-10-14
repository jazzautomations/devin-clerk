"use client";

import { useState } from "react";
import { userMessage } from "@/lib/apiError";

// /perfil "Contato com marcas": revogar daqui faz o mesmo que o botão da
// página do estande (DELETE no opt-in). Some do relatório da marca na hora.
export function ContactShareRevoke({
  hackathonId,
  sponsorId,
  sponsorName,
}: {
  hackathonId: string;
  sponsorId: string;
  sponsorName: string;
}) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function revoke() {
    setState("busy");
    setError(null);
    const res = await fetch(`/api/hackathons/${hackathonId}/sponsors/${sponsorId}/contact`, { method: "DELETE" });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setState("idle");
      setError(userMessage(res, data, "não deu pra revogar agora. Tente de novo."));
      return;
    }
    setState("done");
  }

  return (
    <div className="flex flex-col items-start gap-1">
      {state === "done" ? (
        <p role="status" className="font-mono text-[13px] text-muted">
          revogado. {sponsorName} não vê mais seus dados.
        </p>
      ) : (
        <button
          type="button"
          disabled={state === "busy"}
          onClick={() => void revoke()}
          className="btn-ghost min-h-11 rounded-[6px] disabled:opacity-60"
          aria-label={`revogar o compartilhamento com ${sponsorName}`}
        >
          {state === "busy" ? "revogando…" : "revogar"}
        </button>
      )}
      <p role="alert" className={error ? "font-mono text-[13px] text-orange" : "sr-only"}>
        {error ?? ""}
      </p>
    </div>
  );
}
