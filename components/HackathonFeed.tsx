"use client";

import { useState } from "react";
import type { Hackathon, HackathonFormat } from "@/lib/hackathons";
import { HackathonCard } from "@/components/HackathonCard";

const FORMATS: { value: HackathonFormat | null; label: string }[] = [
  { value: null, label: "todos" },
  { value: "online", label: "online" },
  { value: "presencial", label: "presencial" },
  { value: "hibrido", label: "híbrido" },
];

export function HackathonFeed({
  hackathons,
  tags,
  now,
  registeredIds,
}: {
  hackathons: Hackathon[];
  tags: string[];
  now: string;
  registeredIds: string[];
}) {
  const [format, setFormat] = useState<HackathonFormat | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const nowDate = new Date(now);

  const filtered = hackathons.filter(
    (h) =>
      (format === null || h.format === format) &&
      (tag === null || h.tags.includes(tag)),
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
        {FORMATS.map((f) => (
          <button
            key={f.label}
            onClick={() => setFormat(f.value)}
            className={
              format === f.value
                ? "border border-accent bg-accent/10 px-3 py-1.5 text-accent"
                : "border border-line px-3 py-1.5 text-muted transition hover:border-accent/50 hover:text-foreground"
            }
          >
            {f.label}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-line" aria-hidden />
        {tags.map((t) => (
          <button
            key={t}
            onClick={() => setTag(tag === t ? null : t)}
            className={
              tag === t
                ? "border border-accent bg-accent/10 px-3 py-1.5 text-accent"
                : "border border-line px-3 py-1.5 text-muted transition hover:border-accent/50 hover:text-foreground"
            }
          >
            #{t}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-start gap-3 border border-dashed border-line px-6 py-10">
          <p className="font-mono text-sm text-muted">
            {hackathons.length === 0
              ? "// nenhum hackathon aberto no momento — a curadoria tá trabalhando"
              : "// nenhum evento com esses filtros"}
          </p>
          {hackathons.length > 0 && (
            <button
              onClick={() => {
                setFormat(null);
                setTag(null);
              }}
              className="border border-line px-4 py-2 font-mono text-xs text-muted transition hover:border-accent/50 hover:text-foreground"
            >
              limpar filtros
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((h) => (
            <HackathonCard
              key={h.id}
              hackathon={h}
              now={nowDate}
              registered={registeredIds.includes(h.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
