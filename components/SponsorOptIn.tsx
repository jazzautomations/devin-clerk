"use client";

import { useState } from "react";
import { userMessage } from "@/lib/apiError";

type State = { sharedAt: string | null; revokedAt: string | null };

const fmt = (s: string) => {
  const d = new Date(`${s.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime())
    ? s
    : new Intl.DateTimeFormat("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "America/Sao_Paulo",
      })
        .format(d)
        .replace(",", "");
};

// roadmap 037 #12 — compartilhar / revogar o contato com a marca. O que vai
// está listado na página (com os valores do perfil); revogar vale na hora.
export function SponsorOptIn({
  hackathonId,
  sponsorId,
  sponsorName,
  initial,
}: {
  hackathonId: string;
  sponsorId: string;
  sponsorName: string;
  initial: State;
}) {
  const [state, setState] = useState<State>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(method: "POST" | "DELETE") {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/hackathons/${hackathonId}/sponsors/${sponsorId}/contact`, { method });
    const data = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) return setError(userMessage(res, data, "não deu certo. Tente de novo."));
    setState({ sharedAt: data.sharedAt ?? null, revokedAt: data.revokedAt ?? null });
  }

  if (state.sharedAt) {
    return (
      <div className="flex flex-col gap-3 border-[1.5px] border-accent bg-mint p-4" data-testid="optin-shared">
        <p className="font-semibold">
          Contato compartilhado com {sponsorName} em {fmt(state.sharedAt)}.
        </p>
        <p className="text-[14px] text-muted">
          Mudou de ideia? Revogar tira os seus dados do relatório da marca na hora.
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void call("DELETE")}
          className="btn-ghost w-fit rounded-[6px] disabled:opacity-60"
        >
          revogar compartilhamento
        </button>
        {error && <p className="font-mono text-[13px] text-orange">{error}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="optin-form">
      {state.revokedAt && (
        <p className="font-mono text-[13px] text-muted">Você revogou em {fmt(state.revokedAt)}. Pode compartilhar de novo.</p>
      )}
      <button type="button" disabled={busy} onClick={() => void call("POST")} className="btn w-fit rounded-[6px] disabled:opacity-60">
        compartilhar meu contato com {sponsorName}
      </button>
      {error && <p className="font-mono text-[13px] text-orange">{error}</p>}
    </div>
  );
}
