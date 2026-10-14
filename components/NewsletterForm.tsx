"use client";

import Link from "next/link";
import { useState } from "react";
import { userMessage } from "@/lib/apiError";

// Newsletter da landing. Assinar registra o aceite da política de
// privacidade; a newsletter só sai depois da confirmação pelo e-mail.
export function NewsletterForm() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "done" | "error">("idle");
  const [confirm, setConfirm] = useState<"sent" | "pending" | "already">("pending");
  const [error, setError] = useState("");

  async function subscribe() {
    setStatus("saving");
    setError("");
    const res = await fetch("/api/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, website: "" }),
    }).catch(() => null);
    const data = await res?.json().catch(() => null);
    if (res?.ok) {
      setConfirm(data?.confirm === "sent" || data?.confirm === "already" ? data.confirm : "pending");
      setStatus("done");
      return;
    }
    setError(res ? userMessage(res, data, "não deu pra assinar. Tente de novo.") : "sem conexão. Tente de novo.");
    setStatus("error");
  }

  if (status === "done") {
    return (
      <p role="status" className="border-[1.5px] border-line bg-mint px-4 py-3 font-mono text-xs text-accent">
        {confirm === "sent"
          ? "quase lá. Confirme pelo link que mandamos pro seu e-mail."
          : confirm === "already"
            ? "esse e-mail já está na lista."
            : "anotado. Antes do primeiro envio chega um e-mail pra você confirmar."}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          type="email"
          value={email}
          maxLength={254}
          aria-label="seu e-mail"
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && subscribe()}
          placeholder="seu@email.com"
          className="w-full border-[1.5px] border-line bg-background px-4 py-3 font-mono text-sm text-foreground placeholder:text-[#6b6b6b] focus:border-accent focus:outline-none"
        />
        <input type="text" name="website" className="hidden" tabIndex={-1} autoComplete="off" aria-hidden />
        <button
          onClick={subscribe}
          disabled={status === "saving" || !email}
          className="shrink-0 border-[1.5px] border-line bg-foreground px-6 py-3 text-[15px] font-semibold text-background transition hover:border-accent hover:bg-accent disabled:opacity-50"
        >
          {status === "saving" ? "…" : "assinar →"}
        </button>
      </div>
      <p className="font-mono text-[12px] text-muted">
        Ao assinar, você aceita a{" "}
        <Link href="/legal/privacidade" className="link-inline">
          política de privacidade
        </Link>
        . Dá pra sair por qualquer envio.
      </p>
      <p role="alert" className={status === "error" ? "font-mono text-xs text-orange" : "sr-only"}>
        {status === "error" ? error : ""}
      </p>
    </div>
  );
}
