"use client";

import { useState } from "react";

// frente L — uso de imagem revogável pelo próprio inscrito (perfil ou
// página da edição). Cada clique grava uma linha no histórico (prova).
export function ImageConsentToggle({
  hackathonId,
  granted: initial,
  source,
  label,
}: {
  hackathonId: string;
  granted: boolean;
  source: "perfil" | "edicao";
  /** nome da edição (no perfil, onde há várias) */
  label?: string;
}) {
  const [granted, setGranted] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/hackathons/${hackathonId}/image-consent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ granted: !granted, source }),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && typeof data?.granted === "boolean") setGranted(data.granted);
      else setError("não deu certo, tente de novo");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2" data-testid="image-consent-toggle">
      <p className="min-w-0 text-[14px] leading-snug">
        {label && <span className="font-semibold">{label} · </span>}
        <span className={granted ? "text-accent" : "text-muted"}>
          {granted ? "uso de imagem autorizado" : "uso de imagem não autorizado"}
        </span>
      </p>
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={busy}
        className="shrink-0 rounded-[6px] border-[1.5px] border-line px-3 py-1.5 font-mono text-[12px] hover:border-accent hover:text-accent disabled:opacity-50"
      >
        {busy ? "…" : granted ? "revogar" : "autorizar"}
      </button>
      {error && (
        <p role="alert" className="w-full font-mono text-[12px] text-orange">
          {error}
        </p>
      )}
    </div>
  );
}
