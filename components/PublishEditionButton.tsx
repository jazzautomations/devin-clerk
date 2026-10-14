"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// "Publicar edição": rascunho → no ar (radar, página pública, inscrição).
// O servidor confere o mínimo (data de início e local) e devolve o que falta.
export function PublishEditionButton({ hackathonId, blockers }: { hackathonId: string; blockers: string[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const blocked = blockers.length > 0;

  async function publish() {
    setBusy(true);
    setError("");
    const res = await fetch(`/api/admin/hackathons/${hackathonId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: true }),
    }).catch(() => null);
    const data = await res?.json().catch(() => null);
    setBusy(false);
    if (res?.ok) {
      router.refresh();
      return;
    }
    setError(typeof data?.error === "string" ? data.error : "Não deu pra publicar. Tente de novo.");
  }

  return (
    <div className="flex flex-col gap-2" data-testid="publish-edition">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={publish}
          disabled={busy || blocked}
          aria-describedby={blocked ? "publish-blockers" : undefined}
          className="btn rounded-[6px] disabled:opacity-60"
        >
          {busy ? "publicando…" : "publicar edição"}
        </button>
        <span role="status" className={error ? "font-mono text-[13px] text-orange" : "sr-only"}>
          {error}
        </span>
      </div>
      {blocked ? (
        <p id="publish-blockers" className="font-mono text-[12px] text-muted">
          Antes de publicar, falta: {blockers.join("; ")}.
        </p>
      ) : (
        <p className="font-mono text-[12px] text-muted">
          Publicar coloca a edição no radar e abre a página pública e as inscrições.
        </p>
      )}
    </div>
  );
}
