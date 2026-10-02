"use client";

import { useEffect, useState } from "react";
import { countdownParts } from "@/lib/arena";

// spec 016 — relógio da arena. SSR-safe: o primeiro render usa `nowIso`
// (fixo, vindo do servidor) então o HTML já traz dígitos e o hydrate bate;
// depois o intervalo de 1s passa a contar com o relógio do cliente.

const pad = (n: number) => String(Math.max(0, n)).padStart(2, "0");

export function ArenaCountdown({
  targetIso,
  nowIso,
  label,
  live = false,
}: {
  targetIso: string;
  /** instante do render do servidor — ancora o primeiro paint */
  nowIso: string;
  label: string;
  live?: boolean;
}) {
  const [parts, setParts] = useState(() =>
    countdownParts(targetIso, new Date(nowIso)),
  );

  useEffect(() => {
    const id = setInterval(
      () => setParts(countdownParts(targetIso, new Date())),
      1_000,
    );
    return () => clearInterval(id);
  }, [targetIso]);

  return (
    <div className="flex flex-col gap-1" data-testid="arena-countdown">
      <span className="font-mono text-[10px] tracking-widest text-muted uppercase">
        {"// "}
        {label}
      </span>
      <span
        data-testid="arena-countdown-digits"
        aria-live="off"
        className={`font-mono text-3xl font-bold tracking-tight tabular-nums sm:text-4xl ${
          live ? "text-accent" : "text-foreground"
        }`}
      >
        {pad(parts.d)}:{pad(parts.h)}:{pad(parts.m)}:{pad(parts.s)}
      </span>
    </div>
  );
}
