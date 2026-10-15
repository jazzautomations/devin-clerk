"use client";

import { useState, type ReactNode } from "react";
import type { Hackathon, HackathonFormat } from "@/lib/hackathons";
import {
  SECTION_HINT,
  matchesFilters,
  radarReach,
  radarSections,
  radarUf,
  type RadarFilters,
  type RadarReach,
  type RadarSectionKey,
} from "@/lib/radar";
import { cleanTags } from "@/lib/radarTags";
import { HackathonCard } from "@/components/HackathonCard";

// /radar: Brasil por estado, online aberto pra brasileiro, presencial lá
// fora, online sem regra e o que exclui o Brasil. Filtros por onde, formato,
// brasileiro pode, prazo, prêmio e tema (lib/radar.ts matchesFilters).
const REACH_LABEL: Record<RadarReach, string> = {
  brasil: "no Brasil",
  global: "global",
  outros: "outros países",
};

const FORMATS: { value: HackathonFormat | null; label: string }[] = [
  { value: null, label: "todos" },
  { value: "online", label: "online" },
  { value: "presencial", label: "presencial" },
  { value: "hibrido", label: "híbrido" },
];

const PAGE = 12;

const chip = (on: boolean) =>
  on
    ? "border-[1.5px] border-line bg-foreground px-3 py-1.5 text-band"
    : "border-[1.5px] border-line px-3 py-1.5 text-foreground transition hover:bg-mint hover:text-foreground";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-full text-muted sm:w-auto">{label}:</span>
      {children}
    </div>
  );
}

export function RadarFeed({
  hackathons,
  now,
  registeredIds,
}: {
  hackathons: Hackathon[];
  now: string;
  registeredIds: string[];
}) {
  const [f, setF] = useState<RadarFilters>({});
  const [shown, setShown] = useState<Partial<Record<RadarSectionKey, number>>>({});
  const nowDate = new Date(now);
  const set = (patch: RadarFilters) => setF((old) => ({ ...old, ...patch }));

  const reachCount = (r: RadarReach) => hackathons.filter((h) => radarReach(h) === r).length;
  const ufs = [...new Set(hackathons.filter((h) => radarReach(h) === "brasil").map((h) => radarUf(h)).filter((u): u is string => !!u))].sort();
  const tagCount = new Map<string, number>();
  for (const h of hackathons) for (const t of cleanTags(h.tags)) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
  const topTags = [...tagCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t]) => t);

  const filtered = hackathons.filter((h) => matchesFilters(h, f, nowDate));
  const sections = radarSections(filtered, nowDate);
  const anyFilter = Object.values(f).some((v) => v);

  const cards = (events: Hackathon[]) => (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {events.map((h) => (
        <HackathonCard key={h.id} hackathon={h} now={nowDate} registered={registeredIds.includes(h.id)} />
      ))}
    </div>
  );

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3 font-mono text-xs" data-testid="radar-filtros">
        <Row label="onde">
          <button onClick={() => set({ reach: null, uf: null })} className={chip(!f.reach && !f.uf)}>
            todos
          </button>
          {(["brasil", "global", "outros"] as RadarReach[]).filter((r) => reachCount(r) > 0).map((r) => (
            <button key={r} onClick={() => set({ reach: f.reach === r ? null : r, uf: null })} className={chip(f.reach === r)}>
              {REACH_LABEL[r]} <span className="opacity-70">{reachCount(r)}</span>
            </button>
          ))}
        </Row>
        {ufs.length > 0 && (!f.reach || f.reach === "brasil") && (
          <Row label="estado">
            {ufs.map((u) => (
              <button key={u} onClick={() => set({ uf: f.uf === u ? null : u, reach: null })} className={chip(f.uf === u)}>
                {u.toLowerCase()}
              </button>
            ))}
          </Row>
        )}
        <Row label="formato">
          {FORMATS.map((x) => (
            <button key={x.label} onClick={() => set({ format: x.value })} className={chip((f.format ?? null) === x.value)}>
              {x.label}
            </button>
          ))}
        </Row>
        <Row label="pra você">
          <button
            onClick={() => set({ brazilOnly: !f.brazilOnly })}
            className={chip(!!f.brazilOnly)}
            aria-pressed={!!f.brazilOnly}
          >
            aberto pra brasileiros
          </button>
          <button onClick={() => set({ deadline: f.deadline === "semana" ? null : "semana" })} className={chip(f.deadline === "semana")}>
            fecha esta semana
          </button>
          <button onClick={() => set({ deadline: f.deadline === "mes" ? null : "mes" })} className={chip(f.deadline === "mes")}>
            fecha este mês
          </button>
        </Row>
        <Row label="prêmio">
          <button onClick={() => set({ prize: f.prize === "com" ? null : "com" })} className={chip(f.prize === "com")}>
            com prêmio
          </button>
          <button onClick={() => set({ prize: f.prize === "10k" ? null : "10k" })} className={chip(f.prize === "10k")}>
            US$ 10 mil ou mais
          </button>
        </Row>
        {topTags.length > 0 && (
          <Row label="tema">
            {topTags.map((t) => (
              <button key={t} onClick={() => set({ tag: f.tag === t ? null : t })} className={chip(f.tag === t)}>
                #{t}
              </button>
            ))}
          </Row>
        )}
      </div>

      {sections.length === 0 ? (
        <div className="flex flex-col items-start gap-3 border-[1.5px] border-line px-6 py-10">
          <p className="font-mono text-sm text-muted">
            {hackathons.length === 0 ? "Nenhum hackathon aberto agora. A lista é atualizada duas vezes por dia." : "Nada com esses filtros."}
          </p>
          {anyFilter && (
            <button
              onClick={() => setF({})}
              className="border-[1.5px] border-line px-4 py-2 font-mono text-xs text-foreground transition hover:bg-mint"
            >
              limpar filtros
            </button>
          )}
        </div>
      ) : (
        sections.map((s) => {
          const total = s.groups.reduce((n, g) => n + g.events.length, 0);
          const head = (
            <>
              <h2 id={`radar-${s.key}`} className="text-[clamp(1.4rem,3vw,1.9rem)] leading-none font-extrabold tracking-[-0.035em]">
                {s.title} <span className="font-mono text-sm font-normal text-muted">{total}</span>
              </h2>
              <p className="mt-2 text-[14px] text-muted">{SECTION_HINT[s.key]}</p>
            </>
          );
          if (s.key === "fechado") {
            return (
              <details key={s.key} className="group border-t-2 border-line pt-3" data-testid={`radar-secao-${s.key}`}>
                <summary className="flex cursor-pointer list-none items-start justify-between gap-4 [&::-webkit-details-marker]:hidden">
                  <div>{head}</div>
                  <span className="font-mono text-xs text-muted">
                    <span className="group-open:hidden">ver ▸</span>
                    <span className="hidden group-open:inline">esconder ▾</span>
                  </span>
                </summary>
                <div className="mt-4">{cards(s.groups[0].events)}</div>
              </details>
            );
          }
          const limit = shown[s.key] ?? PAGE;
          let left = limit;
          return (
            <section key={s.key} aria-labelledby={`radar-${s.key}`} className="flex flex-col gap-4" data-testid={`radar-secao-${s.key}`}>
              <div className="border-b-2 border-line pb-2">{head}</div>
              {s.groups.map((g) => {
                if (left <= 0) return null;
                const evs = g.events.slice(0, left);
                left -= evs.length;
                return (
                  <div key={g.uf ?? s.key} className="flex flex-col gap-3">
                    {g.uf && (
                      <h3 className="font-mono text-xs tracking-[0.06em] text-muted uppercase">
                        {g.uf === "BR" ? "cidade a confirmar" : g.uf} · {g.events.length}
                      </h3>
                    )}
                    {cards(evs)}
                  </div>
                );
              })}
              {total > limit && (
                <button
                  onClick={() => setShown((o) => ({ ...o, [s.key]: limit + PAGE * 2 }))}
                  className="self-start border-[1.5px] border-line px-4 py-2 font-mono text-xs text-foreground transition hover:bg-mint"
                >
                  mostrar mais {Math.min(total - limit, PAGE * 2)} · faltam {total - limit}
                </button>
              )}
            </section>
          );
        })
      )}
    </div>
  );
}
