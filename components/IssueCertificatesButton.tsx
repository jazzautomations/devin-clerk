"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// emitir certificados da edição (spec 033 US6) — idempotente no servidor
export function IssueCertificatesButton({ hackathonId, disabled }: { hackathonId: string; disabled: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  async function issue() {
    setBusy(true);
    setMsg("");
    setError("");
    const res = await fetch(`/api/admin/hackathons/${hackathonId}/certificados`, { method: "POST" });
    const data = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      setError(data?.error ?? "não deu pra emitir");
      return;
    }
    setMsg(`${data.created} novos · ${data.total} no total`);
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        onClick={issue}
        disabled={busy || disabled}
        className="btn disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "emitindo…" : "emitir certificados"}
      </button>
      {msg && <span className="font-mono text-[12px] text-accent">{msg}</span>}
      {error && (
        <span role="alert" className="font-mono text-[12px] text-orange">
          {error}
        </span>
      )}
    </div>
  );
}
