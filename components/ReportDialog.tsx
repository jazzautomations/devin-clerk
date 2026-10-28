"use client";

import { useEffect, useId, useRef, useState } from "react";
import { userMessage } from "@/lib/apiError";

// Denunciar pessoa ou conteúdo (migration 032). Abre um <dialog> modal
// (foco preso, Esc fecha) com motivo curto e detalhe opcional, manda pra
// POST /api/reports e confirma. Denunciar conteúdo de alguém também bloqueia
// essa pessoa pra quem denunciou; onReported avisa a tela pra tirar o que é
// dela da vista. As próximas ondas usam no post, depoimento, DM e encontro.

const REASONS = [
  "spam ou propaganda",
  "ofensa ou assédio",
  "conteúdo impróprio",
  "golpe ou informação falsa",
  "outro motivo",
] as const;

const DETAIL_MAX = 400;

export type ReportDialogProps = {
  targetType: "post" | "comment" | "member" | "community" | "depoimento" | "dm" | "encontro" | "desafio" | "desafio_entrega";
  targetId: string | number;
  /** "este post", "o perfil de @ana"… aparece no título */
  targetLabel: string;
  /** @ de quem escreveu (vira bloqueio ao denunciar); sem ele, nada é bloqueado */
  authorUsername?: string | null;
  /** texto do botão que abre */
  triggerLabel?: string;
  triggerClassName?: string;
  onReported?: (r: { blocked: string | null }) => void;
};

export function ReportDialog({
  targetType,
  targetId,
  targetLabel,
  authorUsername = null,
  triggerLabel = "denunciar",
  triggerClassName = "font-mono text-[12px] text-muted underline-offset-4 transition hover:text-orange hover:underline",
  onReported,
}: ReportDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const ids = useId();
  const [reason, setReason] = useState<string>("");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ blocked: string | null } | null>(null);
  // o conteúdo só existe com a caixa aberta: N posts no feed não deixam N
  // formulários escondidos no DOM
  const [shown, setShown] = useState(false);

  function open() {
    setReason("");
    setDetail("");
    setError(null);
    setDone(null);
    setShown(true);
  }
  useEffect(() => {
    if (shown && ref.current && !ref.current.open) ref.current.showModal();
  }, [shown]);
  function close() {
    ref.current?.close();
  }

  // clique fora da caixa fecha (o backdrop é o próprio <dialog>)
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
    if (!reason) return setError("Escolha um motivo.");
    const extra = detail.trim();
    if (reason === "outro motivo" && extra.length < 5) return setError("Conte em poucas palavras o que está errado.");
    setBusy(true);
    setError(null);
    const res = await fetch("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetType, targetId: String(targetId), reason: extra ? `${reason}: ${extra}` : reason }),
    }).catch(() => null);
    setBusy(false);
    if (!res) return setError("Sem conexão. Tente de novo.");
    const data = await res.json().catch(() => null);
    if (!res.ok) return setError(userMessage(res, data, "Não deu certo. Tente de novo."));
    const blocked = (data as { blocked?: string | null } | null)?.blocked ?? null;
    setDone({ blocked });
  }

  return (
    <>
      <button type="button" onClick={open} className={triggerClassName} data-testid="report-open">
        {triggerLabel}
      </button>
      <dialog
        ref={ref}
        aria-labelledby={`${ids}-t`}
        onClose={() => {
          if (done) onReported?.(done);
          setDone(null);
          setShown(false);
        }}
        className="m-auto w-[min(440px,calc(100vw-32px))] max-w-none bg-transparent p-0 text-foreground backdrop:bg-[rgba(12,12,12,0.55)]"
        data-testid="report-dialog"
      >
        {shown && (
          <div className="window paper hard">
            <div className="tbar">
              <span className="title" id={`${ids}-t`}>
                denunciar {targetLabel}
              </span>
              <button type="button" onClick={close} aria-label="fechar" className="px-1 font-mono text-[14px] leading-none">
                x
              </button>
            </div>
            {done ? (
              <div className="flex flex-col gap-4 p-4 font-sans" role="status">
                <p className="text-[16px] font-bold">
                  {done.blocked ? `Recebido. Você não vai mais ver conteúdo de @${done.blocked}.` : "Recebido. A moderação vai olhar."}
                </p>
                <p className="text-[14px] text-muted">
                  Quem modera esse espaço vê o texto denunciado e o motivo. Seu nome não aparece pra ninguém.
                  {done.blocked && " Pra desfazer o bloqueio, vá em perfil, bloqueados."}
                </p>
                <button type="button" onClick={close} className="btn self-start rounded-[6px]" autoFocus>
                  fechar
                </button>
              </div>
            ) : (
              <form onSubmit={send} className="flex flex-col gap-4 p-4 font-sans">
                <fieldset className="flex flex-col gap-1.5">
                  <legend className="mb-1.5 font-mono text-[12px] text-muted uppercase">o que está errado?</legend>
                  {REASONS.map((r) => (
                    <label
                      key={r}
                      className={`flex min-h-[40px] cursor-pointer items-center gap-2.5 border-[1.5px] px-3 py-2 text-[14.5px] transition ${
                        reason === r ? "border-foreground bg-mint" : "border-line-soft hover:border-foreground"
                      }`}
                    >
                      <input
                        type="radio"
                        name={`${ids}-reason`}
                        value={r}
                        checked={reason === r}
                        onChange={() => setReason(r)}
                        className="accent-[var(--accent)]"
                      />
                      {r}
                    </label>
                  ))}
                </fieldset>
                <label className="flex flex-col gap-1.5">
                  <span className="font-mono text-[12px] text-muted">
                    {reason === "outro motivo" ? "conte o que aconteceu" : "quer contar mais? (opcional)"}
                  </span>
                  <textarea
                    value={detail}
                    onChange={(e) => setDetail(e.target.value)}
                    maxLength={DETAIL_MAX}
                    rows={3}
                    className="w-full resize-none rounded-[6px] border-[1.5px] border-line bg-background px-3 py-2 text-[14.5px] focus:border-accent focus:outline-none"
                  />
                </label>
                <p className="text-[13px] text-muted">
                  {authorUsername
                    ? `Ao denunciar, você também bloqueia @${authorUsername}: vocês deixam de se ver no HackaHub. Ninguém é avisado.`
                    : "Ninguém é avisado de que você denunciou."}
                </p>
                {error && (
                  <p role="alert" className="font-mono text-[12.5px] text-orange">
                    {error}
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-3">
                  <button type="submit" disabled={busy} className="btn rounded-[6px] disabled:opacity-60" data-testid="report-send">
                    {busy ? "enviando…" : "enviar denúncia"}
                  </button>
                  <button type="button" onClick={close} className="font-mono text-[13px] text-muted hover:underline">
                    cancelar
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </dialog>
    </>
  );
}
