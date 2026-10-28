"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { userMessage } from "@/lib/apiError";
import { ReportDialog } from "@/components/ReportDialog";

// Menu de segurança no /u de outra pessoa (migration 032): silenciar,
// bloquear e denunciar. Só aparece logado e nunca no próprio perfil (quem
// decide é a página). Bloquear pede confirmação aqui mesmo; silenciar é
// direto, porque não muda nada do lado da outra pessoa.

type Props = { username: string; memberId: number; blocked: boolean; muted: boolean };

export function ProfileSafetyMenu({ username, memberId, blocked, muted }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; undo?: boolean } | null>(null);
  const box = useRef<HTMLDivElement>(null);

  // fecha com Esc e com clique fora
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // Esc com a denúncia aberta fecha só ela
      if (e.key === "Escape" && !document.querySelector("dialog[open]")) setOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  async function act(kind: "block" | "mute", on: boolean, done: string) {
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/members/${encodeURIComponent(username)}/${kind}`, { method: on ? "POST" : "DELETE" }).catch(() => null);
    setBusy(false);
    if (!res) return setMsg({ ok: false, text: "Sem conexão. Tente de novo." });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      return setMsg({ ok: false, text: userMessage(res, data, "Não deu certo. Tente de novo.") });
    }
    setOpen(false);
    setConfirmBlock(false);
    setMsg({ ok: true, text: done, undo: on });
    router.refresh();
  }

  const item =
    "flex min-h-[44px] w-full items-center px-3.5 text-left text-[14.5px] transition hover:bg-mint disabled:opacity-60";

  return (
    <div className="flex flex-col items-start gap-2" data-testid="profile-safety">
      <div ref={box} className="relative">
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => {
            setOpen((v) => !v);
            setConfirmBlock(false);
          }}
          className="btn-ghost min-h-[40px]! rounded-[6px] px-3! font-mono text-[13px]! font-medium!"
          data-testid="profile-safety-toggle"
        >
          opções {open ? "▴" : "▾"}
        </button>
        {open && (
          <div
            role="menu"
            aria-label={`opções sobre @${username}`}
            className="absolute top-[calc(100%+6px)] left-0 z-30 w-[min(300px,calc(100vw-32px))] border-2 border-line bg-background shadow-[4px_4px_0_rgba(12,12,12,0.85)]"
          >
            {confirmBlock ? (
              <div className="flex flex-col gap-3 p-3.5" data-testid="block-confirm">
                <p className="text-[14.5px] leading-snug">
                  <b>Bloquear @{username}?</b> Vocês deixam de se ver no HackaHub: perfil, posts e notificações. Ninguém é
                  avisado.
                </p>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => act("block", true, `Você bloqueou @${username}.`)}
                    className="btn min-h-[40px]! rounded-[6px] bg-orange! border-orange! text-[14px]!"
                    data-testid="block-confirm-yes"
                  >
                    bloquear
                  </button>
                  <button type="button" onClick={() => setConfirmBlock(false)} className="font-mono text-[13px] text-muted hover:underline">
                    voltar
                  </button>
                </div>
              </div>
            ) : (
              <ul className="divide-y divide-line-soft">
                <li>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={busy}
                    onClick={() => act("mute", !muted, muted ? `@${username} voltou pro seu feed.` : `Você silenciou @${username}.`)}
                    className={item}
                    data-testid="safety-mute"
                  >
                    {muted ? "deixar de silenciar" : "silenciar"}
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    role="menuitem"
                    disabled={busy}
                    onClick={() => (blocked ? act("block", false, `Você desbloqueou @${username}.`) : setConfirmBlock(true))}
                    className={item}
                    data-testid="safety-block"
                  >
                    {blocked ? "desbloquear" : "bloquear"}
                  </button>
                </li>
                <li className="flex min-h-[44px] items-center px-3.5" role="none">
                  <ReportDialog
                    targetType="member"
                    targetId={memberId}
                    targetLabel={`o perfil de @${username}`}
                    authorUsername={blocked ? null : username}
                    triggerLabel="denunciar"
                    triggerClassName="w-full text-left text-[14.5px] text-orange"
                    onReported={() => {
                      setOpen(false);
                      router.refresh();
                    }}
                  />
                </li>
              </ul>
            )}
            <p className="border-t border-line-soft px-3.5 py-2 font-mono text-[11.5px] text-muted">
              <Link href="/perfil/bloqueados" className="underline-offset-4 hover:text-accent hover:underline">
                ver quem você bloqueou
              </Link>
            </p>
          </div>
        )}
      </div>
      {msg && (
        <p role={msg.ok ? "status" : "alert"} className={`font-mono text-[12.5px] ${msg.ok ? "text-accent" : "text-orange"}`}>
          {msg.text}
          {msg.undo && (
            <>
              {" "}
              <Link href="/perfil/bloqueados" className="underline underline-offset-4">
                desfazer
              </Link>
            </>
          )}
        </p>
      )}
    </div>
  );
}

/** /perfil/bloqueados: desfaz um bloqueio ou silêncio e recarrega a lista */
export function UndoSafetyButton({ username, kind }: { username: string; kind: "block" | "mute" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function undo() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/members/${encodeURIComponent(username)}/${kind}`, { method: "DELETE" }).catch(() => null);
    setBusy(false);
    if (!res) return setError("Sem conexão. Tente de novo.");
    if (!res.ok) return setError(userMessage(res, await res.json().catch(() => null), "Não deu certo. Tente de novo."));
    router.refresh();
  }
  return (
    <span className="flex shrink-0 flex-col items-end gap-1">
      <button
        type="button"
        onClick={undo}
        disabled={busy}
        aria-label={`${kind === "block" ? "desbloquear" : "deixar de silenciar"} @${username}`}
        className="btn-ghost min-h-[40px]! rounded-[6px] px-3! text-[13px]! disabled:opacity-60"
        data-testid={`undo-${kind}-${username}`}
      >
        desfazer
      </button>
      {error && (
        <span role="alert" className="font-mono text-[12px] text-orange">
          {error}
        </span>
      )}
    </span>
  );
}
