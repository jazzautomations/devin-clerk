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

  // erro que a API não explicou: rate limit, cadastro ainda sendo criado, falha
  function fallbackError(res: Response, data: { error?: unknown } | null): string {
    if (res.status === 429 && typeof data?.error === "string") return data.error;
    if (res.status === 404) return "seu cadastro ainda está sendo criado. Tente de novo em alguns segundos.";
    return "não deu pra concluir agora. Tente de novo.";
  }

  async function register() {
    if (consentText && !consent) {
      setError("marque o aceite acima pra se inscrever");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/hackathons/${hackathonId}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ consent, publicListing: listed }),
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
          // XP por inscrição acabou (nível vem de fato verificado): sem "+N xp"
          const parts = ([] as (string | null)[])
            .concat(data.cardSerial ? [`carta №${String(data.cardSerial).padStart(3, "0")} mintada`] : [])
            .concat(data.newBadges?.length ? [`conquista nova: ${data.newBadges.join(", ")}`] : [])
            .filter(Boolean);
          setReward(parts.join(" · ") || "inscrição confirmada");
        } else if (next === "pending") {
          setReward("pedido enviado. A curadoria vai analisar sua inscrição.");
        } else if (next === "waitlist") {
          setReward("as vagas acabaram. Você entrou na fila e a inscrição é confirmada sozinha se abrir vaga.");
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
      } else {
        setError(fallbackError(res, data));
      }
    } finally {
      setLoading(false);
    }
  }

  async function cancel() {
    const question =
      status === "approved"
        ? "Cancelar a inscrição? Sua vaga vai pra próxima pessoa da fila e não volta."
        : status === "pending"
          ? "Cancelar o pedido de inscrição?"
          : "Sair da fila de espera? Se voltar depois, você entra no fim da fila.";
    if (!window.confirm(question)) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/hackathons/${hackathonId}/register`, { method: "DELETE" });
      if (res.status === 401) {
        router.push("/sign-in");
        return;
      }
      const data = await res.json().catch(() => null);
      if (res.ok) {
        setStatus(null);
        setPosition(null);
        setReward(null);
        router.refresh();
      } else if (res.status === 409 && typeof data?.error === "string") {
        setError(data.error);
      } else {
        setError(fallbackError(res, data));
      }
    } finally {
      setLoading(false);
    }
  }

  const statusText =
    status === "approved"
      ? "✓ você está inscrito"
      : status === "pending"
        ? "pedido enviado, aguardando a curadoria"
        : status === "waitlist"
          ? `fila de espera${position ? ` #${position}` : ""}`
          : status === "rejected"
            ? "não rolou dessa vez"
            : null;

  const cancelLabel =
    status === "approved" ? "cancelar inscrição" : status === "pending" ? "cancelar pedido" : "sair da fila";

  const cls =
    status === "rejected"
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

  if (cancellable || status === "rejected") {
    return (
      <div className="flex flex-col gap-2" data-testid="registration-status">
        <p className={`font-mono text-[13px] font-semibold ${status === "rejected" ? "text-[#b8cdc0]" : "text-mint"}`}>
          {statusText}
        </p>
        {cancellable && (
          <button
            type="button"
            onClick={cancel}
            disabled={loading}
            className="min-h-11 w-fit font-mono text-[12px] text-[#b8cdc0] underline underline-offset-4 transition hover:text-[#f2b880] disabled:opacity-50"
          >
            {loading ? "cancelando…" : cancelLabel}
          </button>
        )}
        {error && <p role="alert" className="font-mono text-[13px] text-[#f2b880]">{error}</p>}
        {reward && <p className="font-mono text-[13px] text-band">{reward}</p>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {consentText && <ConsentBox text={consentText} checked={consent} onChange={setConsent} tone="dark" />}
      <PublicListingBox checked={listed} onChange={setListed} tone="dark" />
      <button onClick={register} disabled={loading} className={cls}>
        {loading ? "…" : requiresApproval ? "pedir lugar" : full ? "entrar na fila de espera" : "inscrever-se em 1 clique"}
      </button>
      <p role="alert" className="font-mono text-[13px] text-[#f2b880] empty:hidden">{error}</p>
      {reward && <p className="font-mono text-[13px] text-band">{reward}</p>}
    </div>
  );
}
