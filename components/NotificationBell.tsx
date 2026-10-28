"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

// linha agrupada (lib/notifications NotificationGroup, migration 040):
// "@a, @b e mais 3 reagiram ao seu post" é uma linha com total 5
type Notification = {
  id: number;
  type: string;
  text: string;
  href: string | null;
  read: boolean;
  createdAt: string;
  total: number;
};

// createdAt é UTC "YYYY-MM-DD HH:MM:SS"
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

type Payload = { groups?: Notification[]; unread?: number };

// só caminho interno, igual ao safeHref do servidor
const internal = (href: string | null) =>
  href && href.startsWith("/") && !href.startsWith("//") && !href.startsWith("/\\") ? href : "/notificacoes";

async function fetchNotifications(): Promise<Payload | null> {
  try {
    const res = await fetch("/api/notifications");
    if (!res.ok) return null;
    return (await res.json()) as Payload;
  } catch {
    return null;
  }
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  // fetch no mount + a cada minuto + ao voltar pra aba + quando outra tela
  // (página /notificacoes) marca como lida — o header vive entre navegações
  // e o contador não pode ficar parado no valor do primeiro carregamento.
  // setState só em callback de promise (padrão fetch-in-effect)
  useEffect(() => {
    let stale = false;
    const refresh = () =>
      fetchNotifications().then((body) => {
        if (stale || !body) return;
        setNotifications((body.groups ?? []).slice(0, 8));
        setUnread(body.unread ?? 0);
      });
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    const onFocus = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("hackahub:notifications", refresh);
    return () => {
      stale = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onFocus);
      window.removeEventListener("hackahub:notifications", refresh);
    };
  }, []);

  // refetch a cada abertura do dropdown (sem polling) — event handler
  const load = useCallback(async () => {
    const body = await fetchNotifications();
    if (!body) return;
    setNotifications((body.groups ?? []).slice(0, 8));
    setUnread(body.unread ?? 0);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = () => {
    setOpen((o) => {
      if (!o) load();
      return !o;
    });
  };

  const readAll = async () => {
    await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "readAll" }),
    }).catch(() => null);
    setNotifications((ns) => ns.map((n) => ({ ...n, read: true })));
    setUnread(0);
  };

  const readOne = (n: Notification) => {
    if (n.read) return;
    fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: n.id, group: true }),
      keepalive: true, // o clique navega na sequência — o POST não pode morrer junto
    }).catch(() => null);
    setNotifications((ns) =>
      ns.map((x) => (x.id === n.id ? { ...x, read: true } : x)),
    );
    // o POST marca o grupo inteiro
    setUnread((u) => Math.max(0, u - Math.max(1, n.total)));
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative flex items-center">
      <button
        type="button"
        aria-label={unread > 0 ? `notificações (${unread} não lidas)` : "notificações"}
        aria-expanded={open}
        onClick={toggle}
        className="relative py-1 text-muted transition hover:text-accent"
      >
        <span aria-hidden className="text-sm leading-none">
          ◈
        </span>
        {unread > 0 && (
          <span className="absolute -right-2 -top-1 min-w-4 rounded-full bg-orange px-1 text-center text-[11px] font-bold leading-4 text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-72 border border-line bg-surface shadow-lg shadow-black/40">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <span className="text-[12px] uppercase tracking-[0.06em] text-muted">
              notificações
            </span>
            {unread > 0 && (
              <button
                type="button"
                onClick={readAll}
                className="text-[12px] text-accent hover:underline"
              >
                marcar todas como lidas
              </button>
            )}
          </div>
          {notifications.length === 0 ? (
            <p className="px-3 py-5 text-center text-muted">
              nenhuma notificação por aqui
            </p>
          ) : (
            <ul className="max-h-80 overflow-y-auto">
              {notifications.map((n) => (
                <li key={n.id} className="border-b border-line last:border-0">
                  <Link
                    href={internal(n.href)}
                    onClick={() => readOne(n)}
                    className="flex gap-2 px-3 py-2 transition hover:bg-line/20"
                  >
                    <span
                      aria-hidden
                      className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                        n.read ? "bg-transparent" : "bg-accent"
                      }`}
                    />
                    <span className="min-w-0">
                      <span
                        className={`block line-clamp-2 break-words ${
                          n.read ? "text-muted" : "text-foreground"
                        }`}
                      >
                        {n.text}
                      </span>
                      <span className="block text-[12px] text-muted">
                        {timeAgo(n.createdAt)}
                        {n.total > 1 && ` · ${n.total}`}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="flex border-t border-line text-[12px]">
            <Link
              href="/notificacoes"
              onClick={() => setOpen(false)}
              className="flex-1 px-3 py-2 text-center text-accent hover:underline"
            >
              ver todas
            </Link>
            <Link
              href="/notificacoes/preferencias"
              onClick={() => setOpen(false)}
              className="flex-1 border-l border-line px-3 py-2 text-center text-muted hover:text-accent hover:underline"
            >
              preferências
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
