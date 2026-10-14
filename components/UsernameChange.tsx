"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// frente N #8 — troca única do username. O antigo fica reservado e
// /u/antigo redireciona pro novo; certificados (/c/[code]) não mudam.
export function UsernameChange({ username, changedAt }: { username: string; changedAt: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  if (changedAt) {
    return (
      <p className="font-mono text-[12px] text-muted" data-testid="username-locked">
        username já trocado uma vez — o link antigo redireciona pro @{username}
      </p>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const next = value.trim().replace(/^@/, "").toLowerCase();
    if (!next || busy) return;
    if (!window.confirm(`Trocar @${username} por @${next}? Só dá pra trocar uma vez.`)) return;
    setBusy(true);
    setErr("");
    const res = await fetch("/api/members/me/username", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: next }),
    }).catch(() => null);
    const data = await res?.json().catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setErr(data?.error ?? "erro ao trocar");
      return;
    }
    setValue("");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2" data-testid="username-change">
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-xs text-muted">
          trocar username (uma vez só — o link antigo continua funcionando)
        </span>
        <span className="flex flex-wrap gap-2">
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={`@${username}`}
            maxLength={21}
            pattern="@?[a-zA-Z0-9_]{3,20}"
            title="3 a 20 caracteres: letras sem acento, números e _"
            className="min-w-0 flex-1 rounded-[6px] border-[1.5px] border-line bg-background px-3 py-2 font-mono text-sm focus:border-accent focus:outline-none"
          />
          <button type="submit" disabled={busy || !value.trim()} className="btn shrink-0">
            {busy ? "…" : "trocar"}
          </button>
        </span>
      </label>
      {err && (
        <p role="alert" className="font-mono text-[13px] text-orange">
          {err}
        </p>
      )}
    </form>
  );
}
