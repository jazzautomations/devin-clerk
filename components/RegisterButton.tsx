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
          ? "border-[1.5px] border-band px-5 py-3 font-mono text-[13px] font-semibold text-band transition hover:bg-band hover:text-foreground disabled:opacity-50"
          : status === "pending"
            ? "border-[1.5px] border-mint px-5 py-3 font-mono text-[13px] font-semibold text-mint transition hover:bg-mint hover:text-foreground disabled:opacity-50"
            : status === "rejected"
              ? "border-[1.5px] border-[#5e7869] px-5 py-3 font-mono text-[13px] text-[#b8cdc0]"
              : "pix border-[1.5px] border-band bg-band px-5 py-1.5 text-[24px] leading-[1.4] text-foreground transition hover:border-background hover:bg-background disabled:opacity-50"
      }
    >
      {label}
    </button>
    {reward && (
      <p className="font-mono text-[13px] text-band">{reward}</p>
    )}
    </div>
  );
}
