"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { RegistrationStatus } from "@/lib/registrations";
import { ConsentBox, errorText, PublicListingBox } from "@/components/RegistrationForm";

type Status = RegistrationStatus | null;

// spec 032 — edição curada (requiresApproval) troca o CTA: "pedir lugar"
// cria pedido pendente (sem recompensa); pendente vê "aguardando
// aprovação" e pode desistir (DELETE cancela o pedido); rejeitado vê o
// veredito honesto, terminal — não clica de novo.
// spec 033 — edição com perguntas leva pro formulário (/h/[id]/inscricao).
// Frente L: toda edição passa pelo formulário (nascimento, código de
// conduta, uso de imagem); o modo 1 clique com a caixa LGPD só sobra pra
// quem chama sem formHref. Edição cheia → fila de espera com posição.
export function RegisterButton({
  hackathonId,
  requiresApproval = false,
  status: initialStatus = null,
  formHref = null,
  consentText = null,
  full = false,
  waitlistPosition = null,
}: {
  hackathonId: string;
  requiresApproval?: boolean;
  status?: Status;
  formHref?: string | null;
  consentText?: string | null;
  full?: boolean;
  waitlistPosition?: number | null;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<Status>(initialStatus);
  const [position, setPosition] = useState<number | null>(waitlistPosition);
  const [loading, setLoading] = useState(false);
  const [consent, setConsent] = useState(false);
  const [listed, setListed] = useState(false);
  const [reward, setReward] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cancellable = status === "approved" || status === "pending" || status === "waitlist";

  async function toggle() {
    if (!cancellable && consentText && !consent) {
      setError("marque o aceite acima pra se inscrever");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/hackathons/${hackathonId}/register`, {
        method: cancellable ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: cancellable ? undefined : JSON.stringify({ consent, publicListing: listed }),
      });
      if (res.status === 401) {
        router.push("/sign-in");
        return;
      }
      const data = await res.json().catch(() => null);
      if (res.ok && data) {
        const next: Status = data.status ?? null;
        setStatus(next);
        setPosition(typeof data.position === "number" ? data.position : null);
        if (next === "approved") {
          const parts = [data.xp ? `${data.xp} xp` : null]
            .concat(data.cardSerial ? [`carta №${String(data.cardSerial).padStart(3, "0")} mintada`] : [])
            .concat(data.newBadges?.length ? [`badge nova: ${data.newBadges.join(", ")}`] : [])
            .filter(Boolean);
          setReward(parts.join(" · "));
        } else if (next === "pending") {
          setReward("pedido enviado — a curadoria revisa tua presença");
        } else if (next === "waitlist") {
          setReward("vagas esgotadas — tu entrou na fila e sobe sozinho se abrir vaga");
        } else {
          setReward(null);
        }
        router.refresh();
      } else if (data?.error === "consent_required") {
        setError("marque o aceite acima pra se inscrever");
      } else if (res.status === 409 && typeof data?.error === "string") {
        setError(errorText(data.error));
      } else if (res.status === 400 && formHref) {
        router.push(formHref);
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
        : status === "waitlist"
          ? `fila de espera${position ? ` #${position}` : ""} — sair da fila`
          : status === "rejected"
            ? "não rolou dessa vez"
            : requiresApproval
              ? "pedir lugar"
              : full
                ? "entrar na fila de espera"
                : "inscrever-se em 1 clique";

  const cls =
    status === "approved"
      ? "border-[1.5px] border-band px-5 py-3 font-mono text-[13px] font-semibold text-band transition hover:bg-band hover:text-foreground disabled:opacity-50"
      : status === "pending" || status === "waitlist"
        ? "border-[1.5px] border-mint px-5 py-3 font-mono text-[13px] font-semibold text-mint transition hover:bg-mint hover:text-foreground disabled:opacity-50"
        : status === "rejected"
          ? "border-[1.5px] border-[#5e7869] px-5 py-3 font-mono text-[13px] text-[#b8cdc0]"
          : "pix border-[1.5px] border-band bg-band px-5 py-1.5 text-[24px] leading-[1.4] text-foreground transition hover:border-background hover:bg-background disabled:opacity-50";

  // edição com formulário: quem ainda não se inscreveu vai pra página do form
  if (status === null && formHref) {
    return (
      <div className="flex flex-col gap-2">
        <Link href={formHref} className={`${cls} block text-center`}>
          {requiresApproval ? "pedir lugar" : full ? "entrar na fila de espera" : "fazer inscrição"}
        </Link>
        <p className="font-mono text-[12px] text-mint">formulário curto da edição · menos de 3 min</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {status === null && consentText && (
        <ConsentBox text={consentText} checked={consent} onChange={setConsent} tone="dark" />
      )}
      {status === null && <PublicListingBox checked={listed} onChange={setListed} tone="dark" />}
      <button onClick={toggle} disabled={loading || status === "rejected"} className={cls}>
        {label}
      </button>
      {error && <p role="alert" className="font-mono text-[13px] text-[#f2b880]">{error}</p>}
      {reward && <p className="font-mono text-[13px] text-band">{reward}</p>}
    </div>
  );
}
