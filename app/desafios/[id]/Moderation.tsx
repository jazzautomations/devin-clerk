"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ReportDialog, type ReportDialogProps } from "@/components/ReportDialog";
import { userMessage } from "@/lib/apiError";

// Moderação no /desafios/[id]: quem modera a comunidade tira do ar o desafio
// ou uma entrega (DELETE na API, com confirmação); o resto denuncia. Depois
// de denunciar, a página recarrega: o bloqueio tira a pessoa da lista.

const link = "font-mono text-[12px] text-muted underline-offset-4 transition hover:text-orange hover:underline";

export function RemoveButton({ url, confirmText, testId }: { url: string; confirmText: string; testId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!window.confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    const res = await fetch(url, { method: "DELETE" }).catch(() => null);
    setBusy(false);
    if (!res) return setError("Sem conexão. Tente de novo.");
    if (!res.ok) return setError(userMessage(res, await res.json().catch(() => null), "Não deu certo. Tente de novo."));
    router.refresh();
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" onClick={remove} disabled={busy} className={`${link} disabled:opacity-60`} data-testid={testId}>
        {busy ? "tirando…" : "tirar do ar"}
      </button>
      {error && (
        <span role="alert" className="font-mono text-[12px] text-orange">
          {error}
        </span>
      )}
    </span>
  );
}

export function ReportButton(props: Omit<ReportDialogProps, "onReported" | "triggerClassName">) {
  const router = useRouter();
  return <ReportDialog {...props} triggerClassName={link} onReported={() => router.refresh()} />;
}
