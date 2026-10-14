"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

// Curadoria da fila "pedir lugar" (spec 032) na aba inscritos — aprovar
// efetiva a inscrição e paga a recompensa (carta/XP/conquistas); recusar
// marca 'rejected'. Em 'rejected' só resta aprovar de novo. Com a edição
// cheia, aprovar põe na fila de espera (o servidor decide e a tela mostra).
export function RegistrationActions({
  hackathonId,
  memberId,
  status,
  name,
}: {
  hackathonId: string;
  memberId: number;
  status: "pending" | "rejected" | "waitlist";
  /** pra o rótulo acessível do botão ("aprovar Ana") */
  name: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"" | "approve" | "reject">("");
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function act(action: "approve" | "reject") {
    setBusy(action);
    setMsg(null);
    const res = await fetch(`/api/admin/hackathons/${hackathonId}/registrations/${memberId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    }).catch(() => null);
    const data = await res?.json().catch(() => null);
    setBusy("");
    if (res?.ok) {
      setMsg({
        kind: "ok",
        text:
          data?.status === "waitlist"
            ? `edição cheia: foi pra fila de espera${data.position ? ` (#${data.position})` : ""}`
            : data?.status === "rejected"
              ? "recusado"
              : "aprovado",
      });
      router.refresh();
    } else {
      setMsg({ kind: "error", text: typeof data?.error === "string" ? data.error : "não deu certo, tente de novo" });
    }
  }

  return (
    <span className="flex flex-wrap items-center gap-2" data-testid="registration-actions">
      {status !== "waitlist" && (
        <button
          type="button"
          onClick={() => act("approve")}
          disabled={busy !== ""}
          aria-label={`aprovar ${name}`}
          className="btn min-h-11 rounded-[6px] disabled:opacity-60"
        >
          {busy === "approve" ? "aprovando…" : "aprovar"}
        </button>
      )}
      {status !== "rejected" && (
        <button
          type="button"
          onClick={() => act("reject")}
          disabled={busy !== ""}
          aria-label={`recusar ${name}`}
          className="btn-ghost min-h-11 rounded-[6px] disabled:opacity-60"
        >
          {busy === "reject" ? "recusando…" : "recusar"}
        </button>
      )}
      <span
        role="status"
        className={msg ? `font-mono text-[12px] ${msg.kind === "ok" ? "text-accent" : "text-orange"}` : "sr-only"}
      >
        {msg?.text ?? ""}
      </span>
    </span>
  );
}
