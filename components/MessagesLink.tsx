"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// Selo de mensagens no header (migration 056): o envelope linka a caixa de
// entrada e o contador mostra as não lidas (mensagens de conversa aberta +
// pedidos recebidos esperando resposta). Mesmo ritmo do sino: fetch no
// mount, a cada minuto e quando a aba volta a ficar visível.
export function MessagesLink() {
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let stale = false;
    const refresh = () =>
      fetch("/api/dm?resumo=1")
        .then((res) => (res.ok ? res.json() : null))
        .then((body: { unread?: number } | null) => {
          if (!stale && body) setUnread(body.unread ?? 0);
        })
        .catch(() => null);
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    const onFocus = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onFocus);
    // a tela da conversa marca como lida e avisa aqui
    window.addEventListener("hackahub:dm", refresh);
    return () => {
      stale = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("hackahub:dm", refresh);
    };
  }, []);

  return (
    <Link
      href="/mensagens"
      aria-label={unread > 0 ? `mensagens (${unread} não lidas)` : "mensagens"}
      className="relative py-1 text-muted transition hover:text-accent"
      data-testid="header-messages"
    >
      <svg aria-hidden width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="block">
        <rect x="1" y="3" width="14" height="10" />
        <path d="M1.5 4l6.5 5 6.5-5" />
      </svg>
      {unread > 0 && (
        <span className="absolute -right-2 -top-1 min-w-4 rounded-full bg-orange px-1 text-center text-[11px] font-bold leading-4 text-white">
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </Link>
  );
}
