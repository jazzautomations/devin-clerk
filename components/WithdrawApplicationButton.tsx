"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// frente E — retirar candidatura pendente (libera a inscrição de participante)
export function WithdrawApplicationButton({ hackathonId, kind }: { hackathonId: string; kind: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function withdraw() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/hackathons/${hackathonId}/applications/${kind}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(typeof data?.error === "string" ? data.error : "não deu certo");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={withdraw}
        disabled={busy}
        className="w-fit font-mono text-[13px] text-muted underline underline-offset-4 hover:text-orange disabled:opacity-50"
      >
        {busy ? "retirando…" : "retirar candidatura"}
      </button>
      {error && (
        <p role="alert" className="font-mono text-[13px] text-orange">
          {error}
        </p>
      )}
    </div>
  );
}
