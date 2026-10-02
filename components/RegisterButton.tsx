"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { RegistrationStatus } from "@/lib/registrations";

type Status = RegistrationStatus | null;

// spec 032 — edição curada (requiresApproval) troca o CTA: "pedir lugar"
// cria pedido pendente (sem recompensa); pendente vê "aguardando
// aprovação" e pode desistir (DELETE cancela o pedido); rejeitado vê o
// veredito honesto, terminal — não clica de novo.
export function RegisterButton({
  hackathonId,
  requiresApproval = false,
  status: initialStatus = null,
}: {
  hackathonId: string;
  requiresApproval?: boolean;
  status?: Status;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>(initialStatus);
  const [loading, setLoading] = useState(false);
  const [reward, setReward] = useState<string | null>(null);

  async function toggle() {
    setLoading(true);
    try {
      const res = await fetch(`/api/hackathons/${hackathonId}/register`, {
        method:
          status === "approved" || status === "pending" ? "DELETE" : "POST",
      });
      if (res.status === 401) {
        router.push("/sign-in");
        return;
      }
      if (res.ok) {
        const data = await res.json();
        const next: Status = data.status ?? null;
        setStatus(next);
        if (next === "approved") {
          const parts = [data.xp ? `${data.xp} xp` : null]
            .concat(data.cardSerial ? [`carta №${String(data.cardSerial).padStart(3, "0")} mintada`] : [])
            .concat(data.newBadges?.length ? [`badge nova: ${data.newBadges.join(", ")}`] : [])
            .filter(Boolean);
          setReward(parts.join(" · "));
        } else if (next === "pending") {
          setReward("pedido enviado — a curadoria revisa tua presença");
        } else {
          setReward(null);
        }
        router.refresh();
      }
    } finally {
      setLoading(false);
    }
  }

  const label = loading
    ? "…"
    : status === "approved"
      ? "✓ inscrito — cancelar inscrição"
      : status === "pending"
        ? "aguardando aprovação — cancelar pedido"
        : status === "rejected"
          ? "não rolou dessa vez"
          : requiresApproval
            ? "pedir lugar"
            : "inscrever-se em 1 clique";

  return (
    <div className="flex flex-col gap-2">
    <button
      onClick={toggle}
      disabled={loading || status === "rejected"}
      className={
        status === "approved"
          ? "border border-accent/50 bg-accent/10 px-6 py-3 font-mono text-sm font-semibold text-accent transition hover:bg-accent/20 disabled:opacity-50"
          : status === "pending"
            ? "border border-accent/40 bg-surface px-6 py-3 font-mono text-sm font-semibold text-muted transition hover:text-accent disabled:opacity-50"
            : status === "rejected"
              ? "border border-line px-6 py-3 font-mono text-sm text-muted opacity-60"
              : "bg-accent px-6 py-3 font-mono text-sm font-semibold text-black transition hover:brightness-110 disabled:opacity-50"
      }
    >
      {label}
    </button>
    {reward && (
      <p className="font-mono text-xs text-accent">{"// "}{reward}</p>
    )}
    </div>
  );
}
