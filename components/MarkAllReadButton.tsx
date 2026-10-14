"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// "marcar todas como lidas" da página /notificacoes — o sino do header
// escuta o evento e zera o contador sem esperar o próximo poll
export function MarkAllReadButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch("/api/notifications", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "readAll" }),
        }).catch(() => null);
        window.dispatchEvent(new Event("hackahub:notifications"));
        router.refresh();
        setBusy(false);
      }}
      className="btn"
    >
      {busy ? "…" : "marcar todas como lidas"}
    </button>
  );
}
