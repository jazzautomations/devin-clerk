"use client";

import { useState } from "react";

type Group = "social" | "comunidade" | "digest";

/**
 * Chave liga/desliga de um grupo. Salva na hora (PATCH) e volta ao estado
 * anterior se o servidor recusar. Sem `group` é só mostrador (essencial).
 */
export function PrefSwitch({
  group,
  initial,
  label,
}: {
  group?: Group;
  initial: boolean;
  label: string;
}) {
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const locked = !group;

  const toggle = async () => {
    if (!group || busy) return;
    const next = !on;
    setOn(next);
    setBusy(true);
    setError(null);
    const field = group === "digest" ? "email" : "inApp";
    try {
      const res = await fetch("/api/notifications/preferencias", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ group, [field]: next }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Não deu pra salvar.");
      }
      window.dispatchEvent(new Event("hackahub:notifications"));
    } catch (e) {
      setOn(!next);
      setError(e instanceof Error ? e.message : "Não deu pra salvar.");
    }
    setBusy(false);
  };

  return (
    <span className="flex flex-col items-end gap-1">
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        aria-disabled={locked || undefined}
        disabled={locked}
        onClick={toggle}
        data-testid={group ? `pref-${group}` : "pref-essencial"}
        className={`relative inline-flex h-7 w-12 shrink-0 items-center border-[1.5px] transition ${
          on ? "border-accent bg-accent" : "border-line bg-background"
        } ${locked ? "cursor-not-allowed opacity-50" : "cursor-pointer"} ${busy ? "opacity-70" : ""}`}
      >
        <span
          aria-hidden
          className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 transition-[left] ${
            on ? "left-[calc(100%-1.25rem)] bg-background" : "left-[3px] bg-foreground"
          }`}
        />
      </button>
      <span className="font-mono text-[11px] text-muted" aria-hidden>
        {on ? "ligado" : "desligado"}
      </span>
      {error && (
        <span role="alert" className="max-w-[16ch] text-right font-mono text-[11px] text-orange">
          {error}
        </span>
      )}
    </span>
  );
}
