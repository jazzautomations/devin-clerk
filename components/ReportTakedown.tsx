"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { userMessage } from "@/lib/apiError";

// Tirar do ar pela fila de denúncias. Hoje só depoimento de time: o texto
// sai do perfil, o dono não traz de volta e a denúncia fica resolvida.
// Pede confirmação no segundo toque.

export function ReportTakedown({ id }: { id: number }) {
  const router = useRouter();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    if (busy) return;
    if (!confirm) return setConfirm(true);
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/reports/${id}/takedown`, { method: "POST" }).catch(() => null);
    setBusy(false);
    if (!res) return setError("Sem conexão. Tente de novo.");
    if (!res.ok) return setError(userMessage(res, await res.json().catch(() => null), "Não deu certo. Tente de novo."));
    router.refresh();
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className={`btn-ghost min-h-[40px]! rounded-[6px] px-3! text-[13px]! disabled:opacity-60 ${confirm ? "border-orange! text-orange!" : ""}`}
        data-testid={`takedown-${id}`}
      >
        {busy ? "…" : confirm ? "tirar do ar mesmo" : "tirar do ar"}
      </button>
      {confirm && !busy && <p className="font-mono text-[12px] text-muted">Sai do perfil de vez. A denúncia fica resolvida.</p>}
      {error && (
        <p role="alert" className="font-mono text-[12.5px] text-orange">
          {error}
        </p>
      )}
    </div>
  );
}
