"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { userMessage } from "@/lib/apiError";
import { DM_BODY_MAX, DM_REQUEST_MAX, type DmEntry } from "@/lib/dmText";

// O botão de mensagem no /u de outra pessoa (migration 056). O servidor
// decide o modo (dmEntryPoint): 'aberta' linka a conversa, 'nova-livre'
// abre a caixa pra primeira mensagem, 'pedido-novo' abre a caixa do pedido
// de até 280, 'pedido-recebido' linka o aceite, 'pedido-enviado' e
// 'recusada' são texto. Com bloqueio o servidor nem renderiza (entry null).
// O motivo da trava fica ao lado do botão, em texto comum.

export function DmStart({ username, entry }: { username: string; entry: DmEntry }) {
  const router = useRouter();
  const ref = useRef<HTMLDialogElement>(null);
  const [shown, setShown] = useState(false);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const request = entry.mode === "pedido-novo";
  const max = request ? DM_REQUEST_MAX : DM_BODY_MAX;
  useEffect(() => {
    if (shown && ref.current && !ref.current.open) ref.current.showModal();
  }, [shown]);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const onClick = (e: MouseEvent) => {
      if (e.target === d) d.close();
    };
    d.addEventListener("click", onClick);
    return () => d.removeEventListener("click", onClick);
  }, []);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim() || busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/dm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, body }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => null) : null;
    setBusy(false);
    if (!res) return setError("Sem conexão. Tente de novo.");
    if (!res.ok) return setError(userMessage(res, data, "Não deu pra enviar. Tente de novo."));
    const threadId = (data as { threadId?: number } | null)?.threadId;
    if (request) {
      setSent(true);
      ref.current?.close();
    } else if (threadId) {
      router.push(`/mensagens/${threadId}`);
      router.refresh();
    }
  }

  if (entry.mode === "pedido-enviado") {
    return (
      <p className="font-mono text-[12.5px] text-muted" data-testid="dm-entry">
        pedido de conversa enviado
      </p>
    );
  }
  if (entry.mode === "recusada") {
    return (
      <p className="font-mono text-[12.5px] text-muted" data-testid="dm-entry">
        {entry.motivo}
      </p>
    );
  }
  if (entry.mode === "aberta" || entry.mode === "pedido-recebido") {
    return (
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="dm-entry">
        <Link
          href={`/mensagens/${entry.threadId}`}
          className="btn-ghost min-h-[40px]! rounded-[6px] px-3.5! font-mono text-[13px]!"
        >
          {entry.mode === "aberta" ? "mensagem" : "aceitar pedido"}
        </Link>
        <span className="font-mono text-[12px] text-muted">{entry.motivo}</span>
      </span>
    );
  }

  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="dm-entry">
      <button
        type="button"
        onClick={() => {
          setBody("");
          setError(null);
          setShown(true);
        }}
        className="btn-ghost min-h-[40px]! rounded-[6px] px-3.5! font-mono text-[13px]!"
        data-testid={request ? "dm-ask" : "dm-write"}
      >
        {request ? "pedir conversa" : "mensagem"}
      </button>
      <span className="font-mono text-[12px] text-muted" data-testid="dm-motivo">
        {entry.motivo}
      </span>
      {sent && (
        <span className="font-mono text-[12px] text-accent" data-testid="dm-sent">
          pedido enviado — espera a resposta
        </span>
      )}
      <dialog
        ref={ref}
        aria-label={request ? `pedir conversa com @${username}` : `mensagem pra @${username}`}
        onClose={() => setShown(false)}
        className="m-auto w-[min(440px,calc(100vw-32px))] max-w-none bg-transparent p-0 text-foreground backdrop:bg-[rgba(12,12,12,0.55)]"
        data-testid="dm-dialog"
      >
        {shown && (
          <div className="window paper hard">
            <div className="tbar">
              <span className="title">{request ? `pedir conversa com @${username}` : `mensagem pra @${username}`}</span>
              <button type="button" onClick={() => ref.current?.close()} aria-label="fechar" className="px-1 font-mono text-[14px] leading-none">
                x
              </button>
            </div>
            <form onSubmit={send} className="flex flex-col gap-4 p-4 font-sans">
              {request && (
                <p className="text-[13.5px] text-muted">
                  Vocês ainda não têm laço. Escreva em uma mensagem por que faz sentido conversar — a pessoa aceita ou
                  recusa, sem aviso.
                </p>
              )}
              <label className="flex flex-col gap-1.5">
                <span className="font-mono text-[12px] text-muted">{request ? "o pedido" : "a primeira mensagem"}</span>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={3}
                  maxLength={max}
                  autoFocus
                  className="w-full resize-none rounded-[6px] border-[1.5px] border-line bg-background px-3 py-2 text-[14.5px] focus:border-accent focus:outline-none"
                  data-testid="dm-first"
                />
              </label>
              <div className="flex flex-wrap items-center gap-3">
                <button type="submit" disabled={busy || !body.trim()} className="btn rounded-[6px] disabled:opacity-60" data-testid="dm-first-send">
                  {busy ? "enviando…" : request ? "mandar pedido" : "enviar"}
                </button>
                <span className="font-mono text-[12px] text-muted">{max - [...body].length} caracteres</span>
                <button
                  type="button"
                  onClick={() => ref.current?.close()}
                  className="font-mono text-[13px] text-muted hover:underline"
                >
                  cancelar
                </button>
              </div>
              {error && (
                <p role="alert" className="font-mono text-[12.5px] text-orange">
                  {error}
                </p>
              )}
            </form>
          </div>
        )}
      </dialog>
    </span>
  );
}
