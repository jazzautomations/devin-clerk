"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Liga do semestre (migration 054): a própria pessoa escolhe aparecer na
// lista da liga. Desligado, ela continua vendo a própria faixa e some da
// lista de todo mundo. Revogável a qualquer momento.
export function LigaOptInToggle({ initial }: { initial: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/me/liga", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ optIn: next }),
      }).catch(() => null);
      const data = (await res?.json().catch(() => null)) as { optIn?: boolean } | null;
      if (res?.ok && typeof data?.optIn === "boolean") {
        setOn(data.optIn);
        router.refresh();
      } else {
        setError("não deu certo, tente de novo");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="flex cursor-pointer items-start gap-2 text-[15px] leading-snug">
        <input
          type="checkbox"
          data-testid="liga-optin-toggle"
          className="mt-0.5 size-4 shrink-0 accent-[#047a43]"
          checked={on}
          disabled={busy}
          onChange={(e) => void toggle(e.target.checked)}
        />
        <span>
          aparecer na lista da liga
          <span className="block font-mono text-[12px] text-muted">
            {on ? "seu nome e sua faixa aparecem pra quem também ativou" : "só você vê a sua faixa"}
          </span>
        </span>
      </label>
      {error && (
        <p role="alert" className="font-mono text-[12px] text-orange">
          {error}
        </p>
      )}
    </div>
  );
}
