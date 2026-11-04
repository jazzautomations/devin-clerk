"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { userMessage } from "@/lib/apiError";
// módulo puro: o recado em si fala com o banco em lib/recados.ts
import { RECADO_MAX } from "@/lib/recadosText";

// Caixa de recado no perfil (migration 041). Texto puro, até RECADO_MAX:
// sem markdown, sem preview. Quem pode escrever é decidido no servidor
// (members.recadosFrom) e a rota revalida; aqui só não mostramos a caixa
// quando o servidor disse que não dá.
export function RecadoComposer({ username }: { username: string }) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const left = RECADO_MAX - [...body].length;

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return setError("Escreva o recado.");
    setStatus("sending");
    setError(null);
    const res = await fetch(`/api/members/${encodeURIComponent(username)}/recados`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => null) : null;
    if (!res || !res.ok) {
      setStatus("idle");
      setError(res ? userMessage(res, data, "Não deu pra deixar o recado. Tente de novo.") : "Sem conexão. Tente de novo.");
      return;
    }
    setBody("");
    setStatus("sent");
    router.refresh();
  }

  return (
    <form onSubmit={send} className="flex flex-col gap-2" data-testid="recado-form">
      <label className="flex flex-col gap-1.5">
        <span className="font-mono text-[12px] text-muted">deixar recado</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={3}
          maxLength={RECADO_MAX}
          aria-label="recado"
          placeholder="texto curto, do jeito que você falaria"
          className="w-full resize-y rounded-[6px] border-[1.5px] border-line bg-background px-3 py-2 text-[15px] focus:border-accent focus:outline-none"
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={status === "sending"}
          className="btn min-h-[44px]! rounded-[6px] px-4! py-2! text-[14px]! disabled:opacity-60"
          data-testid="recado-enviar"
        >
          {status === "sending" ? "enviando…" : "deixar recado"}
        </button>
        <span className="font-mono text-[12px] text-muted" data-testid="recado-restante">
          {left} caracteres
        </span>
        {status === "sent" && (
          <span className="font-mono text-[12px] text-accent" data-testid="recado-ok">
            recado deixado
          </span>
        )}
      </div>
      {error && (
        <p role="alert" className="font-mono text-xs text-orange" data-testid="recado-erro">
          {error}
        </p>
      )}
    </form>
  );
}
