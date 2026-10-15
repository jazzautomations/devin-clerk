// Radar: Brasil primeiro e o mundo logo depois, com o que a pessoa precisa
// pra decidir (formato, alcance, se brasileiro pode, prêmio, prazo). Módulo
// puro (sem db): roda no server e no client.
//
// Região (coluna `region`, preenchida pelo scraper — scripts/scrape_radar.py
// region_of; quando vazia, derivamos aqui com a mesma regra):
//   br            presencial/híbrido no Brasil
//   online-br     online, organizador brasileiro ou em português
//   online-mundo  online, de fora
//   exterior      presencial fora do Brasil
// Alcance (`scope`, migration 026): global | latam | brasil | pais | cidade.
// Brasileiro pode (`brazilOk`): 'sim' | 'nao' | null (não informado). O
// scraper só grava sim/não com evidência (regra da fonte ou evento no Brasil).
import { eventRegion } from "@/lib/regions";
import { cleanTags } from "@/lib/radarTags";

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
  hosted: boolean;
  region?: string | null;
  source?: string | null;
  // radar global (migration 026), gravado pelo scraper
  scope?: string | null;
  country?: string | null;
  brazilOk?: string | null;
  prizeUsd?: number | null;
  submissionDeadline?: string | null;
  tags?: string[];
};

// fontes brasileiras: Sympla, Doity, curadoria, indicação, terceiro posto no
// admin e a casa (sem fonte, seed ou painel)
const BR_SOURCES = new Set(["sympla", "doity", "curadoria", "comunidade", "admin", "meetup", "seed", "painel"]);
// português sem confundir com espanhol (que não tem ã/õ nem "ção")
const PT_RE = /[ãõ]|ç[ãõ]|\b(dos|das|nas|nos|pra|você|edição|inscriç\w*|maratona|soluç\w*|inovaç\w*|tecnologia|saúde|educação)\b/i;

export function radarRegion(h: RadarEvent): RadarRegion {
  if (h.region && (RADAR_REGIONS as string[]).includes(h.region)) return h.region as RadarRegion;
  // edição da casa (sem fonte) é brasileira
  const sources = (h.source ?? "").split("+");
  const br = h.hosted || !h.source || sources.some((s) => BR_SOURCES.has(s));
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

export type RadarScope = "global" | "latam" | "brasil" | "pais" | "cidade";

// alcance gravado pelo scraper; vazio deriva da região
export function radarScope(h: RadarEvent): RadarScope {
  if (h.scope && ["global", "latam", "brasil", "pais", "cidade"].includes(h.scope)) return h.scope as RadarScope;
  const r = radarRegion(h);
  if (r === "online-br") return "brasil";
  if (r === "online-mundo") return "global";
  if (r === "br") return h.location ? "cidade" : "brasil";
  return "cidade";
}

// brasileiro pode participar? Coluna do scraper. Linha que o scraper já
// avaliou (tem alcance) e deixou vazia é "não informado" (ex.: online em
// português de Portugal). Linha sem avaliação (edição da casa, indicação
// antiga): evento no Brasil é 'sim', o resto fica null.
export function brazilCanJoin(h: RadarEvent): "sim" | "nao" | null {
  if (h.brazilOk === "sim" || h.brazilOk === "nao") return h.brazilOk;
  if (h.scope) return null;
  return isBrasil(h) ? "sim" : null;
}

export function isOnline(h: RadarEvent): boolean {
  const r = radarRegion(h);
  return h.format === "online" || r === "online-br" || r === "online-mundo";
}

// até quando dá pra entrar: prazo de inscrição; sem ele, o fim (se já
// começou) ou o início
export function closesAt(h: RadarEvent, now = new Date()): number {
  const started = new Date(h.startsAt).getTime() <= now.getTime();
  const ref = h.registrationDeadline ?? (started ? (h.endsAt ?? h.startsAt) : h.startsAt);
  return new Date(ref).getTime();
}

export const CLOSING_SOON_MS = 48 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function closesSoon(h: RadarEvent, now = new Date()): boolean {
  const t = closesAt(h, now);
  return !Number.isNaN(t) && t - now.getTime() < CLOSING_SOON_MS;
}

export function isBrasil(h: RadarEvent): boolean {
  const r = radarRegion(h);
  return r === "br" || r === "online-br";
}

// Landing "abertos agora": amostra curta que mistura Brasil (edições da
// casa e hackathons daqui) com 1–2 globais grandes abertos pra brasileiros.
// Nada que feche em menos de 48h. `count` é o radar inteiro relevante (o que
// ainda dá pra entrar e não fecha a porta pra brasileiro), base do "+N".
// `open` já vem ordenado pela próxima data (getOpenHackathons).
export function landingSample<T extends RadarEvent>(
  open: T[],
  now = new Date(),
  size = 4,
): { sample: T[]; count: number } {
  const relevant = open.filter((h) => !closesSoon(h, now) && brazilCanJoin(h) !== "nao");
  const local = [
    ...relevant.filter((h) => h.hosted),
    ...relevant.filter((h) => !h.hosted && isBrasil(h)),
  ];
  const globals = relevant
    .filter((h) => !h.hosted && !isBrasil(h) && isOnline(h) && brazilCanJoin(h) === "sim")
    .sort((a, b) => (b.prizeUsd ?? 0) - (a.prizeUsd ?? 0));
  const nGlobal = Math.min(globals.length, size, Math.max(size - local.length, 2));
  const sample = [...local.slice(0, size - nGlobal), ...globals.slice(0, nGlobal)];
  return { sample, count: relevant.length };
}

// Painel: hackathons do Brasil (edições da casa primeiro), com a UF (e a
// cidade) do perfil na frente. Gringo e o que fecha em 48h ficam de fora.
export function dashboardList<T extends RadarEvent>(
  open: T[],
  now = new Date(),
  opts: { city?: string | null; exclude?: Set<string>; limit?: number } = {},
): T[] {
  const { city, exclude, limit = 5 } = opts;
  const uf = city ? radarUf({ id: "", name: "", format: "presencial", location: city, startsAt: "", endsAt: null, registrationDeadline: null, prize: null, hosted: false }) : null;
  const cityKey = city?.split(",")[0].trim().toLowerCase() || null;
  const score = (h: T) => {
    if (cityKey && h.location?.toLowerCase().includes(cityKey)) return 0;
    if (uf && radarUf(h) === uf) return 1;
    return 2;
  };
  const radar = open
    .filter((h) => !h.hosted && isBrasil(h) && !closesSoon(h, now))
    .map((h, i) => ({ h, i }))
    .sort((a, b) => score(a.h) - score(b.h) || a.i - b.i)
    .map(({ h }) => h);
  return [...open.filter((h) => h.hosted), ...radar]
    .filter((h) => !exclude?.has(h.id))
    .slice(0, limit);
}

// prêmio no painel: só em real. ₹, €, US$ ficam pro /radar.
export function prizeInReais(prize: string | null): string | null {
  return prize && prize.trim().startsWith("R$") ? prize : null;
}

// ---------- prêmio curto ----------

const CURRENCIES: [string, string][] = [
  ["R$", "R$"],
  ["US$", "US$"],
  ["C$", "C$"],
  ["CAD", "C$"],
  ["A$", "A$"],
  ["$", "US$"],
  ["€", "€"],
  ["£", "£"],
  ["₹", "₹"],
  ["¥", "¥"],
];

function shortNumber(n: number): string {
  const f = (x: number) => x.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
  if (n >= 1_000_000) return `${f(n / 1_000_000)} mi`;
  if (n >= 1_000) return `${f(Math.round(n / 100) / 10)} mil`;
  return String(n);
}

// "$138,000" → "US$ 138 mil"; "$1,000,000" → "US$ 1 mi"; "R$ 15 mil" fica.
// Sem moeda reconhecível, devolve como veio.
export function compactPrize(prize: string | null | undefined): string | null {
  if (!prize) return null;
  const s = prize.trim();
  if (/\bmil\b|\bmi\b/i.test(s)) return s;
  const cur = CURRENCIES.find(([k]) => s.startsWith(k));
  if (!cur) return s;
  const num = s.slice(cur[0].length).trim().replace(/[.,]\d{2}$/, "");
  const digits = num.replace(/\D/g, "");
  if (!digits) return s;
  const mult = /k$/i.test(num) ? 1000 : 1;
  return `${cur[1]} ${shortNumber(Number(digits) * mult)}`;
}

// câmbio aproximado, só pra dar a ordem de grandeza em real
export const USD_BRL = 5.5;

export function prizeBrlApprox(h: Pick<RadarEvent, "prize" | "prizeUsd">): string | null {
  if (!h.prizeUsd || (h.prize ?? "").trim().startsWith("R$")) return null;
  return `≈ R$ ${shortNumber(Math.round(h.prizeUsd * USD_BRL))}`;
}

// ---------- selos do card ----------

const FORMAT_LABEL: Record<string, string> = { online: "online", presencial: "presencial", hibrido: "híbrido" };

export function scopeLabel(h: RadarEvent): string {
  const s = radarScope(h);
  if (s === "global") return "global";
  if (s === "latam") return "América Latina";
  if (s === "brasil") return "Brasil";
  if (s === "pais") return h.country ? `só ${h.country}` : "um país";
  // cidade: no Brasil a UF; lá fora o país
  if (isBrasil(h)) return radarUf(h) ?? "Brasil";
  return h.country ?? "lá fora";
}

export function closingLabel(h: RadarEvent, now = new Date()): string | null {
  const t = closesAt(h, now);
  if (Number.isNaN(t)) return null;
  const days = Math.floor((t - now.getTime()) / DAY_MS);
  if (t < now.getTime() || days > 14) return null;
  if (days <= 0) return "fecha hoje";
  if (days === 1) return "fecha amanhã";
  return `fecha em ${days} dias`;
}

export type RadarBadges = {
  where: string;
  brazil: "sim" | "nao" | null;
  prize: string | null;
  closing: string | null;
};

export function radarBadges(h: RadarEvent, now = new Date()): RadarBadges {
  return {
    where: `${FORMAT_LABEL[h.format] ?? h.format} · ${scopeLabel(h)}`,
    brazil: brazilCanJoin(h),
    prize: compactPrize(h.prize),
    closing: closingLabel(h, now),
  };
}

export const BRAZIL_LABEL = { sim: "aberto pra brasileiros", nao: "não aceita brasileiros" } as const;

// ---------- filtros do /radar ----------

export type RadarReach = "brasil" | "global" | "outros";

export function radarReach(h: RadarEvent): RadarReach {
  if (isBrasil(h)) return "brasil";
  const s = radarScope(h);
  return s === "global" || s === "latam" ? "global" : "outros";
}

export type RadarFilters = {
  format?: string | null;
  reach?: RadarReach | null;
  uf?: string | null;
  brazilOnly?: boolean;
  deadline?: "semana" | "mes" | null;
  prize?: "com" | "10k" | null;
  tag?: string | null;
};

export function matchesFilters(h: RadarEvent, f: RadarFilters, now = new Date()): boolean {
  if (f.format && h.format !== f.format) return false;
  if (f.reach && radarReach(h) !== f.reach) return false;
  if (f.uf && radarUf(h) !== f.uf) return false;
  if (f.brazilOnly && brazilCanJoin(h) !== "sim") return false;
  if (f.deadline) {
    const t = closesAt(h, now) - now.getTime();
    const max = f.deadline === "semana" ? 7 * DAY_MS : 31 * DAY_MS;
    if (Number.isNaN(t) || t > max) return false;
  }
  if (f.prize === "com" && !h.prize) return false;
  if (f.prize === "10k" && (h.prizeUsd ?? 0) < 10_000) return false;
  if (f.tag && !cleanTags(h.tags ?? []).includes(f.tag)) return false;
  return true;
}

// ---------- seções do /radar ----------

export type RadarSectionKey = "brasil" | "online-aberto" | "lafora" | "nao-informado" | "fechado";

export const SECTION_TITLE: Record<RadarSectionKey, string> = {
  brasil: "No Brasil",
  "online-aberto": "Online e abertos pra brasileiros",
  lafora: "Presencial lá fora",
  "nao-informado": "Não informado se brasileiro pode",
  fechado: "Não aceitam brasileiros",
};

export const SECTION_HINT: Record<RadarSectionKey, string> = {
  brasil: "Presencial e híbrido, por estado.",
  "online-aberto": "Dá pra fazer de casa. A regra deixa brasileiro entrar.",
  lafora: "Precisa viajar. Confira a regra no site oficial.",
  "nao-informado": "Online, mas a página não diz de quais países aceita. Leia a regra antes de se inscrever.",
  fechado: "A regra exclui o Brasil. Fica aqui pra você não perder tempo.",
};

const SECTION_ORDER: RadarSectionKey[] = ["brasil", "online-aberto", "lafora", "nao-informado", "fechado"];

export function radarSectionOf(h: RadarEvent): RadarSectionKey {
  const ok = brazilCanJoin(h);
  if (ok === "nao") return "fechado";
  if (radarRegion(h) === "br") return "brasil";
  if (isOnline(h)) return ok === "sim" ? "online-aberto" : "nao-informado";
  return "lafora";
}

export type RadarSection<T> = { key: RadarSectionKey; title: string; groups: { uf: string | null; events: T[] }[] };

// /radar: Brasil (por UF, a UF com mais eventos primeiro), online aberto pra
// brasileiro (por prazo e, no mesmo prazo, maior prêmio), presencial lá fora,
// online sem regra e, por último, o que exclui o Brasil.
export function radarSections<T extends RadarEvent>(list: T[], now = new Date()): RadarSection<T>[] {
  return SECTION_ORDER.map((key) => {
    let events = list.filter((h) => radarSectionOf(h) === key);
    if (key === "online-aberto") {
      events = events
        .map((h, i) => ({ h, i, t: closesAt(h, now) }))
        .sort((a, b) => {
          const da = Math.floor(a.t / DAY_MS);
          const dbb = Math.floor(b.t / DAY_MS);
          return da - dbb || (b.h.prizeUsd ?? 0) - (a.h.prizeUsd ?? 0) || a.i - b.i;
        })
        .map(({ h }) => h);
    }
    if (key !== "brasil") return { key, title: SECTION_TITLE[key], groups: events.length ? [{ uf: null, events }] : [] };
    const byUf = new Map<string, T[]>();
    for (const h of events) {
      const uf = radarUf(h) ?? "BR";
      byUf.set(uf, [...(byUf.get(uf) ?? []), h]);
    }
    const groups = [...byUf.entries()]
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .map(([uf, evs]) => ({ uf, events: evs }));
    return { key, title: SECTION_TITLE[key], groups };
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
