// Radar Brasil-first: região de cada evento e as regras de lista da landing
// e do painel. Módulo puro (sem db): roda no server e no client.
//
// Região (coluna `region`, preenchida pelo scraper — scripts/scrape_radar.py
// region_of; quando vazia, derivamos aqui com a mesma regra):
//   br            presencial/híbrido no Brasil
//   online-br     online, organizador brasileiro ou em português
//   online-mundo  online, de fora
//   exterior      presencial fora do Brasil
import { eventRegion } from "@/lib/regions";

export type RadarRegion = "br" | "online-br" | "online-mundo" | "exterior";
export const RADAR_REGIONS: RadarRegion[] = ["br", "online-br", "online-mundo", "exterior"];

export type RadarEvent = {
  id: string;
  name: string;
  format: string;
  location: string | null;
  startsAt: string;
  endsAt: string | null;
  registrationDeadline: string | null;
  prize: string | null;
  partner: boolean;
  region?: string | null;
  source?: string | null;
};

// fontes brasileiras: Sympla, Doity, curadoria, indicação, admin e a casa
const BR_SOURCES = new Set(["sympla", "doity", "curadoria", "comunidade", "admin", "meetup"]);
// português sem confundir com espanhol (que não tem ã/õ nem "ção")
const PT_RE = /[ãõ]|ç[ãõ]|\b(dos|das|nas|nos|pra|você|edição|inscriç\w*|maratona|soluç\w*|inovaç\w*|tecnologia|saúde|educação)\b/i;

export function radarRegion(h: RadarEvent): RadarRegion {
  if (h.region && (RADAR_REGIONS as string[]).includes(h.region)) return h.region as RadarRegion;
  // edição da casa (sem fonte) é brasileira
  const sources = (h.source ?? "").split("+");
  const br = h.partner || !h.source || sources.some((s) => BR_SOURCES.has(s));
  const where = eventRegion(h);
  if (where.length === 2 || where === "brasil") return "br";
  if (h.format !== "online") return br && !h.location ? "br" : "exterior";
  return br || PT_RE.test(h.name) || (h.prize ?? "").startsWith("R$") ? "online-br" : "online-mundo";
}

// UF do evento brasileiro ("SP"), quando dá pra saber
export function radarUf(h: RadarEvent): string | null {
  const r = eventRegion(h);
  return r.length === 2 ? r : null;
}

// até quando dá pra entrar: prazo de inscrição; sem ele, o fim (se já
// começou) ou o início
export function closesAt(h: RadarEvent, now = new Date()): number {
  const started = new Date(h.startsAt).getTime() <= now.getTime();
  const ref = h.registrationDeadline ?? (started ? (h.endsAt ?? h.startsAt) : h.startsAt);
  return new Date(ref).getTime();
}

export const CLOSING_SOON_MS = 48 * 60 * 60 * 1000;

export function closesSoon(h: RadarEvent, now = new Date()): boolean {
  const t = closesAt(h, now);
  return !Number.isNaN(t) && t - now.getTime() < CLOSING_SOON_MS;
}

const isBrasil = (h: RadarEvent) => {
  const r = radarRegion(h);
  return r === "br" || r === "online-br";
};

// Landing "Próximas edições": edições Hack Inova e hackathons do Brasil
// (presencial ou online em português). Gringo online e o que fecha em menos
// de 48h ficam de fora. Edição da casa entra enquanto estiver aberta — o
// prazo dela é a página de inscrição. Sobrou pouco, mostra pouco.
// `open` já vem ordenado pela próxima data (getOpenHackathons).
export function landingList<T extends RadarEvent>(open: T[], now = new Date(), limit = 6): T[] {
  const radar = open.filter((h) => !h.partner && isBrasil(h) && !closesSoon(h, now));
  return [...open.filter((h) => h.partner), ...radar].slice(0, limit);
}

// Painel: a mesma regra, com a UF (e a cidade) do perfil na frente.
export function dashboardList<T extends RadarEvent>(
  open: T[],
  now = new Date(),
  opts: { city?: string | null; exclude?: Set<string>; limit?: number } = {},
): T[] {
  const { city, exclude, limit = 5 } = opts;
  const uf = city ? radarUf({ id: "", name: "", format: "presencial", location: city, startsAt: "", endsAt: null, registrationDeadline: null, prize: null, partner: false }) : null;
  const cityKey = city?.split(",")[0].trim().toLowerCase() || null;
  const score = (h: T) => {
    if (cityKey && h.location?.toLowerCase().includes(cityKey)) return 0;
    if (uf && radarUf(h) === uf) return 1;
    return 2;
  };
  const radar = open
    .filter((h) => !h.partner && isBrasil(h) && !closesSoon(h, now))
    .map((h, i) => ({ h, i }))
    .sort((a, b) => score(a.h) - score(b.h) || a.i - b.i)
    .map(({ h }) => h);
  return [...open.filter((h) => h.partner), ...radar]
    .filter((h) => !exclude?.has(h.id))
    .slice(0, limit);
}

// prêmio na landing/painel: só em real. ₹, €, US$ ficam pro /radar.
export function prizeInReais(prize: string | null): string | null {
  return prize && prize.trim().startsWith("R$") ? prize : null;
}

export type RadarSection = { region: RadarRegion; title: string; groups: { uf: string | null; events: RadarEvent[] }[] };

export const SECTION_TITLE: Record<RadarRegion, string> = {
  br: "No Brasil",
  "online-br": "Online em português",
  "online-mundo": "Online no mundo",
  exterior: "Presencial lá fora",
};

// /radar: Brasil (agrupado por UF, a UF com mais eventos primeiro), depois
// online em português, online no mundo e presencial lá fora.
export function radarSections<T extends RadarEvent>(list: T[]): { region: RadarRegion; title: string; groups: { uf: string | null; events: T[] }[] }[] {
  return RADAR_REGIONS.map((region) => {
    const events = list.filter((h) => radarRegion(h) === region);
    if (region !== "br") return { region, title: SECTION_TITLE[region], groups: events.length ? [{ uf: null, events }] : [] };
    const byUf = new Map<string, T[]>();
    for (const h of events) {
      const uf = radarUf(h) ?? "BR";
      byUf.set(uf, [...(byUf.get(uf) ?? []), h]);
    }
    const groups = [...byUf.entries()]
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .map(([uf, evs]) => ({ uf, events: evs }));
    return { region, title: SECTION_TITLE[region], groups };
  }).filter((s) => s.groups.length > 0);
}

// "Centro Universitário de Maceió – UNIMA/Afya, Maceió, AL" → "Maceió, AL":
// na linha curta da landing/painel a cidade importa mais que o prédio
export function shortLocation(loc: string | null): string | null {
  if (!loc) return loc;
  const parts = loc.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 3 && /^[A-Z]{2}$/.test(parts[parts.length - 1])) return parts.slice(-2).join(", ");
  return loc;
}
