"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { userMessage } from "@/lib/apiError";
import { ReportDialog } from "@/components/ReportDialog";
import { DM_BODY_MAX, type DmMessage, type DmPeer, type ThreadStatus } from "@/lib/dmText";

// A conversa (migration 056). Poll de 15s só com a aba visível — aba em
// segundo plano não fica batendo na API. Enter envia, Shift+Enter quebra
// linha. O menu tem bloquear (vai pro /api/members/[u]/block da Onda 0) e
// denunciar a última mensagem da outra pessoa (ReportDialog, targetType
// 'dm' — a fila recebe só o snapshot dela). Pedido recebido mostra aceitar
// e recusar; recusar é silencioso.

type Payload = {
  thread: { id: number; status: ThreadStatus; iRequested: boolean; peer: DmPeer };
  messages: DmMessage[];
  mais: number | null;
  falar: boolean;
  motivo: string;
};

function timeAgo(iso: string): string {
  const then = new Date(`${iso.replace(" ", "T")}Z`).getTime();
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return "agora";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  return new Date(then).toLocaleDateString("pt-BR");
}

function mergeMessages(cur: DmMessage[], inc: DmMessage[]): DmMessage[] {
  if (!inc.length) return cur;
  const seen = new Set(cur.map((m) => m.id));
  const fresh = inc.filter((m) => !seen.has(m.id));
  return fresh.length ? [...cur, ...fresh].sort((a, b) => a.id - b.id) : cur;
}

export function DmThread({
  threadId,
  peer,
  initialMessages,
  initialMais,
  initialStatus,
  iRequested,
  initialFalar,
  lockMotivo,
}: {
  threadId: number;
  peer: DmPeer;
  initialMessages: DmMessage[];
  initialMais: number | null;
  initialStatus: ThreadStatus;
  iRequested: boolean;
  initialFalar: boolean;
  lockMotivo: string;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<DmMessage[]>(initialMessages);
  const [mais, setMais] = useState<number | null>(initialMais);
  const [status, setStatus] = useState<ThreadStatus>(initialStatus);
  const [falar, setFalar] = useState(initialFalar);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const lastPeerMsgId = [...messages].reverse().find((m) => !m.mine)?.id ?? null;

  // poll de 15s, só com a aba visível (e um fetch ao voltar pra ela)
  useEffect(() => {
    let stale = false;
    const pull = async () => {
      if (document.visibilityState !== "visible") return;
      const res = await fetch(`/api/dm/${threadId}`).catch(() => null);
      if (stale || !res || !res.ok) return;
      const data = (await res.json().catch(() => null)) as Payload | null;
      if (stale || !data) return;
      setMessages((cur) => mergeMessages(cur, data.messages));
      setStatus(data.thread.status);
      setFalar(data.falar);
      if (data.mais === null) setMais(null);
    };
    const timer = window.setInterval(pull, 15_000);
    const onVisible = () => void pull();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stale = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [threadId]);

  // fecha o menu com Esc e clique fora
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("dialog[open]")) setMenuOpen(false);
    };
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [menuOpen]);

  // mensagem nova desce a conversa (só quando já está no fim ou é minha)
  const lastId = messages[messages.length - 1]?.id;
  const lastMine = messages[messages.length - 1]?.mine;
  useEffect(() => {
    if (lastMine || status === "pedido") bottomRef.current?.scrollIntoView({ block: "end" });
  }, [lastId, lastMine, status]);

  const loadOlder = useCallback(async () => {
    if (!mais) return;
    const res = await fetch(`/api/dm/${threadId}?antes=${mais}`).catch(() => null);
    if (!res || !res.ok) return;
    const data = (await res.json().catch(() => null)) as Payload | null;
    if (!data) return;
    setMessages((cur) => mergeMessages(data.messages, cur));
    setMais(data.mais);
  }, [mais, threadId]);

  async function send() {
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/dm/${threadId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: text }),
    }).catch(() => null);
    const data = res ? await res.json().catch(() => null) : null;
    setBusy(false);
    if (!res) return setError("Sem conexão. Tente de novo.");
    if (!res.ok) {
      if (res.status === 404) setFalar(false);
      return setError(userMessage(res, data, "Não deu pra enviar. Tente de novo."));
    }
    const msg = (data as { message?: DmMessage } | null)?.message;
    if (msg) setMessages((cur) => mergeMessages(cur, [{ ...msg, mine: true, authorUsername: "você" }]));
    setBody("");
  }

  async function decide(action: "accept" | "decline") {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/dm/${threadId}/${action}`, { method: "POST" }).catch(() => null);
    setBusy(false);
    if (!res) return setError("Sem conexão. Tente de novo.");
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      return setError(userMessage(res, data, "Não deu certo. Tente de novo."));
    }
    setStatus(action === "accept" ? "aberta" : "recusada");
    if (action === "accept") setFalar(true);
    router.refresh();
  }

  async function block() {
    setBusy(true);
    const res = await fetch(`/api/members/${encodeURIComponent(peer.username)}/block`, { method: "POST" }).catch(() => null);
    setBusy(false);
    if (!res || !res.ok) {
      setMenuOpen(false);
      return setError("Não deu pra bloquear. Tente de novo.");
    }
    router.push("/mensagens");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3" data-testid="dm-thread">
      <div className="flex items-start justify-between gap-3">
        <p className="font-mono text-[12px] text-muted" data-testid="dm-motivo">
          {lockMotivo}
        </p>
        <div ref={menuRef} className="relative shrink-0">
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => {
              setMenuOpen((v) => !v);
              setConfirmBlock(false);
            }}
            className="btn-ghost min-h-[36px]! rounded-[6px] px-2.5! font-mono text-[12px]!"
            data-testid="dm-menu"
          >
            opções {menuOpen ? "▴" : "▾"}
          </button>
          {menuOpen && (
            <div
              role="menu"
              aria-label="opções da conversa"
              className="absolute top-[calc(100%+6px)] right-0 z-30 w-[min(280px,calc(100vw-32px))] border-2 border-line bg-background shadow-[4px_4px_0_rgba(12,12,12,0.85)]"
            >
              {confirmBlock ? (
                <div className="flex flex-col gap-3 p-3.5" data-testid="dm-block-confirm">
                  <p className="text-[14px] leading-snug">
                    <b>Bloquear @{peer.username}?</b> A conversa fica no histórico, mas vocês deixam de se ver no
                    HackaHub. Ninguém é avisado.
                  </p>
                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={block}
                      className="btn min-h-[40px]! rounded-[6px] bg-orange! border-orange! text-[14px]!"
                      data-testid="dm-block-yes"
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
                      onClick={() => setConfirmBlock(true)}
                      className="flex min-h-[44px] w-full items-center px-3.5 text-left text-[14.5px] transition hover:bg-mint"
                      data-testid="dm-block"
                    >
                      bloquear @{peer.username}
                    </button>
                  </li>
                  <li className="flex min-h-[44px] items-center px-3.5" role="none">
                    {lastPeerMsgId ? (
                      <ReportDialog
                        targetType="dm"
                        targetId={lastPeerMsgId}
                        targetLabel="esta mensagem"
                        authorUsername={peer.username}
                        triggerLabel="denunciar última mensagem"
                        triggerClassName="w-full text-left text-[14.5px] text-orange"
                        onReported={() => {
                          setMenuOpen(false);
                          router.refresh();
                        }}
                      />
                    ) : (
                      <span className="font-mono text-[12px] text-muted">sem mensagem pra denunciar</span>
                    )}
                  </li>
                </ul>
              )}
            </div>
          )}
        </div>
      </div>

      {status === "pedido" && !iRequested && (
        <div className="flex flex-col gap-3 border-[1.5px] border-line bg-mint px-3.5 py-3" data-testid="dm-pedido">
          <p className="text-[14.5px]">
            <b>@{peer.username} pediu pra conversar com você.</b> Aceite pra abrir a conversa — ou recuse, e a pessoa
            não é avisada.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => decide("accept")}
              className="btn min-h-[40px]! rounded-[6px] px-4! text-[14px]!"
              data-testid="dm-accept"
            >
              aceitar
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => decide("decline")}
              className="btn-ghost min-h-[40px]! rounded-[6px] px-4! text-[14px]!"
              data-testid="dm-decline"
            >
              recusar
            </button>
          </div>
        </div>
      )}
      {status === "pedido" && iRequested && (
        <p className="border-[1.5px] border-dashed border-line px-3.5 py-3 font-mono text-[12.5px] text-muted" data-testid="dm-espera">
          Pedido enviado. @{peer.username} precisa aceitar pra conversa abrir.
        </p>
      )}
      {status === "recusada" && (
        <p className="border-[1.5px] border-dashed border-line px-3.5 py-3 font-mono text-[12.5px] text-muted" data-testid="dm-recusada">
          {iRequested ? "Pedido recusado." : "Você recusou este pedido."}
        </p>
      )}

      <ul className="flex flex-col gap-2" data-testid="dm-messages">
        {mais !== null && (
          <li className="text-center">
            <button type="button" onClick={loadOlder} className="font-mono text-[12px] text-accent underline-offset-4 hover:underline" data-testid="dm-older">
              mensagens antigas
            </button>
          </li>
        )}
        {messages.map((m) => (
          <li key={m.id} className={`flex ${m.mine ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] border-[1.5px] px-3 py-2 ${
                m.mine ? "border-accent bg-mint" : "border-line bg-surface"
              }`}
              data-testid={m.mine ? "dm-msg-mine" : "dm-msg-peer"}
            >
              <p className="whitespace-pre-wrap text-[14.5px] leading-snug [overflow-wrap:anywhere]">{m.body}</p>
              <p className="mt-1 text-right font-mono text-[10.5px] text-muted">{timeAgo(m.createdAt)}</p>
            </div>
          </li>
        ))}
      </ul>
      <div ref={bottomRef} />

      {falar ? (
        <div className="flex flex-col gap-2" data-testid="dm-composer">
          <label className="flex flex-col gap-1.5">
            <span className="sr-only">mensagem</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={2}
              maxLength={DM_BODY_MAX}
              placeholder="escreva a mensagem — Enter envia, Shift+Enter quebra linha"
              className="w-full resize-none rounded-[6px] border-[1.5px] border-line bg-background px-3 py-2 text-[15px] focus:border-accent focus:outline-none"
              data-testid="dm-input"
            />
          </label>
          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={busy || !body.trim()}
              onClick={() => void send()}
              className="btn min-h-[44px]! rounded-[6px] px-4! py-2! text-[14px]! disabled:opacity-60"
              data-testid="dm-send"
            >
              {busy ? "enviando…" : "enviar"}
            </button>
            <span className="font-mono text-[12px] text-muted">{DM_BODY_MAX - [...body].length} caracteres</span>
          </div>
        </div>
      ) : (
        status === "aberta" && (
          <p className="border-[1.5px] border-line px-3.5 py-3 font-mono text-[12.5px] text-muted" data-testid="dm-fechada">
            Vocês não podem mais conversar.
          </p>
        )
      )}
      {error && (
        <p role="alert" className="font-mono text-xs text-orange" data-testid="dm-erro">
          {error}
        </p>
      )}
    </div>
  );
}
