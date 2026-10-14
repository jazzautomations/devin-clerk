"use client";

import { useEffect, useRef, useState } from "react";
import type { StageSnapshot } from "@/lib/stage";

// Modo palco — peças client compartilhadas pelo telão, pelo celular de
// quem vota e pelo controle: o hook do stream e o cronômetro.

export type StageConn = "conectando" | "ao vivo" | "polling";

const WATCHDOG_MS = 40_000; // heartbeat vem a cada 15s; 40s sem nada = conexão morta
const POLL_MS = 3_000;
const MAX_SSE_FAILS = 3;

/**
 * Snapshot do palco em tempo real. SSE primeiro; o EventSource reconecta
 * sozinho, e um watchdog derruba conexão zumbi (proxy que segura bytes).
 * Depois de 3 falhas seguidas sem nenhum evento, cai pra polling do
 * GET /stage e tenta o SSE de novo a cada minuto.
 */
export function useStageStream(hackathonId: string, initial: StageSnapshot) {
  const [snap, setSnap] = useState(initial);
  const [conn, setConn] = useState<StageConn>("conectando");

  useEffect(() => {
    let es: EventSource | null = null;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let poll: ReturnType<typeof setInterval> | undefined;
    let retrySse: ReturnType<typeof setTimeout> | undefined;
    let fails = 0;
    let stopped = false;

    const apply = (data: string) => {
      try {
        setSnap(JSON.parse(data) as StageSnapshot);
      } catch {
        // evento corrompido: ignora, o próximo corrige
      }
    };

    const pollOnce = async () => {
      try {
        const r = await fetch(`/api/hackathons/${hackathonId}/stage`, { cache: "no-store" });
        if (r.ok) apply(await r.text());
      } catch {
        // sem rede: tenta no próximo ciclo
      }
    };

    const startPolling = () => {
      if (poll || stopped) return;
      setConn("polling");
      void pollOnce();
      poll = setInterval(pollOnce, POLL_MS);
      retrySse = setTimeout(() => {
        clearInterval(poll);
        poll = undefined;
        fails = 0;
        connect();
      }, 60_000);
    };

    const arm = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        es?.close();
        fails += 1;
        if (fails >= MAX_SSE_FAILS) startPolling();
        else connect();
      }, WATCHDOG_MS);
    };

    function connect() {
      if (stopped) return;
      if (typeof EventSource === "undefined") {
        startPolling();
        return;
      }
      es?.close();
      setConn("conectando");
      es = new EventSource(`/api/hackathons/${hackathonId}/stage/stream`);
      arm();
      es.addEventListener("stage", (e) => {
        fails = 0;
        setConn("ao vivo");
        arm();
        apply((e as MessageEvent<string>).data);
      });
      es.addEventListener("ping", () => {
        fails = 0;
        arm();
      });
      es.onerror = () => {
        // CLOSED = o browser desistiu (ex.: 404/500); CONNECTING = vai tentar sozinho
        if (es?.readyState === EventSource.CLOSED) {
          fails += 1;
          if (fails >= MAX_SSE_FAILS) startPolling();
          else setTimeout(connect, 3_000);
        } else {
          setConn("conectando");
        }
      };
    }

    connect();
    return () => {
      stopped = true;
      es?.close();
      clearTimeout(watchdog);
      clearInterval(poll);
      clearTimeout(retrySse);
    };
  }, [hackathonId]);

  return { snap, conn, setSnap };
}

/** "02:57"; estourou → "+00:12" */
export function formatClock(ms: number): string {
  const over = ms < 0;
  const total = over ? Math.floor(-ms / 1000) : Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${over ? "+" : ""}${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Cronômetro do pitch. O servidor manda `remainingMs` calculado na hora
 * do snapshot; aqui ancora no relógio monotônico do aparelho e conta
 * sozinho — relógio errado no celular/telão não importa.
 */
export function StageTimer({
  timer,
  className = "",
  tone = "",
  showBar = false,
}: {
  timer: StageSnapshot["timer"];
  className?: string;
  /** cor no tempo normal; nos últimos 30s vira âmbar e estourado vira laranja */
  tone?: string;
  showBar?: boolean;
}) {
  const anchor = useRef({ remaining: timer.remainingMs, at: 0, running: timer.running });
  const [ms, setMs] = useState(timer.remainingMs);

  useEffect(() => {
    anchor.current = { remaining: timer.remainingMs, at: performance.now(), running: timer.running };
    const tick = () => {
      const a = anchor.current;
      setMs(a.running ? a.remaining - (performance.now() - a.at) : a.remaining);
    };
    const raf = requestAnimationFrame(tick);
    const id = setInterval(tick, 200);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(id);
    };
  }, [timer.remainingMs, timer.running]);

  const total = timer.pitchSeconds * 1000;
  const over = ms < 0;
  const low = !over && ms <= 30_000;
  const pct = Math.max(0, Math.min(100, (ms / total) * 100));
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="stage-timer">
      <span
        aria-live="off"
        data-running={timer.running ? "1" : "0"}
        className={`pix leading-[0.8] tabular-nums ${over ? "text-orange" : low ? "text-[#f2b880]" : tone} ${className}`}
      >
        {formatClock(ms)}
      </span>
      {showBar && (
        <div className="h-3 w-full border-2 border-current" aria-hidden>
          <div
            className={`h-full ${over ? "bg-orange" : low ? "bg-[#f2b880]" : "bg-band"}`}
            style={{ width: `${over ? 100 : pct}%`, transition: "width 0.2s linear" }}
          />
        </div>
      )}
    </div>
  );
}

/** média em pt-BR com vírgula: 4,25 */
export const fmtAvg = (n: number | null) =>
  n === null ? "—" : n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 });
