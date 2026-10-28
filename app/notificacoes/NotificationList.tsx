"use client";

import { useState } from "react";
import { Avatar } from "@/components/Avatar";
import type { NotificationGroup } from "@/lib/notifications";

const fmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const when = (createdAt: string) => fmt.format(new Date(`${createdAt.replace(" ", "T")}Z`));

function Row({ n }: { n: NotificationGroup }) {
  const grouped = n.total > 1;
  return (
    <li className="border-t border-line">
      <a
        href={`/api/notifications/${n.id}/open`}
        data-read={n.read ? "1" : "0"}
        data-total={n.total}
        data-testid="notification-row"
        className="flex gap-3 px-1 py-3 transition hover:bg-line/10"
      >
        <span
          aria-hidden
          className={`mt-2.5 h-2 w-2 shrink-0 rounded-full ${n.read ? "bg-transparent" : "bg-accent"}`}
        />
        {n.actors.length > 0 && (
          <span aria-hidden className="flex shrink-0 -space-x-2 pt-0.5">
            {n.actors.slice(0, grouped ? 3 : 1).map((a) => (
              <Avatar
                key={`${a.id ?? a.username}`}
                username={a.username}
                name={a.name}
                avatarUrl={a.avatarUrl}
                size="md"
                className="ring-2 ring-background"
              />
            ))}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className={`block break-words ${n.read ? "text-muted" : "font-semibold text-foreground"}`}>
            {n.text}
          </span>
          <span className="block font-mono text-[12px] text-muted">
            {when(n.createdAt)}
            {grouped && ` · ${n.total} avisos`}
            {!n.read && " · não lida"}
          </span>
        </span>
      </a>
    </li>
  );
}

/**
 * Lista agrupada do /notificacoes. A primeira página vem do servidor; "mais"
 * pede a próxima pelo cursor (id da cabeça do último grupo).
 */
export function NotificationList({
  initial,
  next: initialNext,
  aba,
}: {
  initial: NotificationGroup[];
  next: number | null;
  aba: "tudo" | "mencoes";
}) {
  const [items, setItems] = useState(initial);
  const [next, setNext] = useState(initialNext);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const more = async () => {
    if (next === null) return;
    setBusy(true);
    setFailed(false);
    const qs = new URLSearchParams({ antes: String(next), limite: "30" });
    if (aba === "mencoes") qs.set("aba", "mencoes");
    try {
      const res = await fetch(`/api/notifications?${qs}`);
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { groups?: NotificationGroup[]; next?: number | null };
      setItems((cur) => {
        const seen = new Set(cur.map((x) => x.id));
        return [...cur, ...(body.groups ?? []).filter((x) => !seen.has(x.id))];
      });
      setNext(body.next ?? null);
    } catch {
      setFailed(true);
    }
    setBusy(false);
  };

  return (
    <div className="flex flex-col gap-4">
      <ul className="border-b border-line" data-testid="notification-list">
        {items.map((n) => (
          <Row key={n.id} n={n} />
        ))}
      </ul>
      {next !== null && (
        <button type="button" onClick={more} disabled={busy} className="btn self-center" data-testid="notification-more">
          {busy ? "carregando…" : "mais"}
        </button>
      )}
      {failed && (
        <p role="status" className="text-center font-mono text-[13px] text-muted">
          Não deu pra carregar agora. Tente de novo.
        </p>
      )}
    </div>
  );
}
