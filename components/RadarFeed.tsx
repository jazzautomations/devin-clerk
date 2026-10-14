"use client";

import { useState } from "react";
import type { Hackathon, HackathonFormat } from "@/lib/hackathons";
import { RADAR_REGIONS, SECTION_TITLE, radarRegion, radarSections, radarUf, type RadarRegion } from "@/lib/radar";
import { HackathonCard } from "@/components/HackathonCard";

// /radar: Brasil primeiro (por UF), depois online em português, online no
// mundo e presencial lá fora. Filtro por onde, UF e formato.
const WHERE_LABEL: Record<RadarRegion, string> = {
  br: "no brasil",
  "online-br": "online em português",
  "online-mundo": "online no mundo",
  exterior: "lá fora",
};

const FORMATS: { value: HackathonFormat | null; label: string }[] = [
  { value: null, label: "todos" },
  { value: "online", label: "online" },
  { value: "presencial", label: "presencial" },
  { value: "hibrido", label: "híbrido" },
];

const chip = (on: boolean) =>
  on
    ? "border-[1.5px] border-line bg-foreground px-3 py-1.5 text-band"
    : "border-[1.5px] border-line px-3 py-1.5 text-foreground transition hover:bg-mint hover:text-foreground";

export function RadarFeed({
  hackathons,
  now,
  registeredIds,
}: {
  hackathons: Hackathon[];
  now: string;
  registeredIds: string[];
}) {
  const [where, setWhere] = useState<RadarRegion | null>(null);
  const [uf, setUf] = useState<string | null>(null);
  const [format, setFormat] = useState<HackathonFormat | null>(null);
  const nowDate = new Date(now);

  const count = (r: RadarRegion) => hackathons.filter((h) => radarRegion(h) === r).length;
  const ufs = [...new Set(hackathons.filter((h) => radarRegion(h) === "br").map((h) => radarUf(h)).filter((u): u is string => !!u))].sort();

  const filtered = hackathons.filter(
    (h) =>
      (where === null || radarRegion(h) === where) &&
      (uf === null || radarUf(h) === uf) &&
      (format === null || h.format === format),
  );
  const sections = radarSections(filtered);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3 font-mono text-xs" data-testid="radar-filtros">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted">onde:</span>
          <button onClick={() => { setWhere(null); setUf(null); }} className={chip(where === null && uf === null)}>
            todos
          </button>
          {RADAR_REGIONS.filter((r) => count(r) > 0).map((r) => (
            <button key={r} onClick={() => { setWhere(where === r ? null : r); setUf(null); }} className={chip(where === r)}>
              {WHERE_LABEL[r]} <span className="opacity-70">{count(r)}</span>
            </button>
          ))}
        </div>
        {ufs.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted">estado:</span>
            {ufs.map((u) => (
              <button key={u} onClick={() => { setUf(uf === u ? null : u); setWhere(null); }} className={chip(uf === u)}>
                {u.toLowerCase()}
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted">formato:</span>
          {FORMATS.map((f) => (
            <button key={f.label} onClick={() => setFormat(f.value)} className={chip(format === f.value)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {sections.length === 0 ? (
        <div className="flex flex-col items-start gap-3 border-[1.5px] border-line px-6 py-10">
          <p className="font-mono text-sm text-muted">
            {hackathons.length === 0 ? "Nenhum hackathon aberto agora. A curadoria olha as fontes todo dia." : "Nada com esses filtros."}
          </p>
          {hackathons.length > 0 && (
            <button
              onClick={() => { setWhere(null); setUf(null); setFormat(null); }}
              className="border-[1.5px] border-line px-4 py-2 font-mono text-xs text-foreground transition hover:bg-mint"
            >
              limpar filtros
            </button>
          )}
        </div>
      ) : (
        sections.map((s) => (
          <section key={s.region} aria-labelledby={`radar-${s.region}`} className="flex flex-col gap-4" data-testid={`radar-secao-${s.region}`}>
            <h2 id={`radar-${s.region}`} className="border-b-2 border-line pb-2 text-[clamp(1.4rem,3vw,1.9rem)] leading-none font-extrabold tracking-[-0.035em]">
              {SECTION_TITLE[s.region]}{" "}
              <span className="font-mono text-sm font-normal text-muted">{s.groups.reduce((n, g) => n + g.events.length, 0)}</span>
            </h2>
            {s.groups.map((g) => (
              <div key={g.uf ?? s.region} className="flex flex-col gap-3">
                {g.uf && (
                  <h3 className="font-mono text-xs tracking-[0.06em] text-muted uppercase">
                    {g.uf === "BR" ? "cidade a confirmar" : g.uf} · {g.events.length}
                  </h3>
                )}
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {g.events.map((h) => (
                    <HackathonCard
                      key={h.id}
                      hackathon={h as Hackathon}
                      now={nowDate}
                      registered={registeredIds.includes(h.id)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </section>
        ))
      )}
    </div>
  );
}
