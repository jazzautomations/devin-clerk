// Bucket geográfico do card. A localização raspada é texto livre
// ("Belém, PA", "Santa Casa, São Paulo", "Mumbai, Índia", null), então a
// região é derivada por heurística BR — nunca inventa, cai em "exterior"
// quando não reconhece. Módulo puro (sem db): pode rodar no client.

export type Regionable = { format: string; location: string | null };

const UFS = new Set([
  "ac", "al", "ap", "am", "ba", "ce", "df", "es", "go", "ma", "mt", "ms",
  "mg", "pa", "pb", "pr", "pe", "pi", "rj", "rn", "rs", "ro", "rr", "sc",
  "sp", "se", "to",
]);

// cidade → UF: capitais + cidades fortes de hackathon no Brasil
const CITY_UF: [RegExp, string][] = [
  [/s[ãa]o paulo|alphaville|campinas|s[ãa]o jos[ée] dos campos|santos|barueri|sorocaba|ribeir[ãa]o preto|jundia[íi]|s[ãa]o bernardo|osasco|piracicaba|s[ãa]o carlos/, "SP"],
  [/rio de janeiro|niter[óo]i/, "RJ"],
  [/belo horizonte|uberl[âa]ndia|ouro preto/, "MG"],
  [/porto alegre|canoas/, "RS"],
  [/florian[óo]polis|joinville|blumenau/, "SC"],
  [/curitiba|londrina|maring[áa]/, "PR"],
  [/recife|olinda|caruaru/, "PE"],
  [/salvador|lauro de freitas/, "BA"],
  [/fortaleza|caucaia/, "CE"],
  [/bras[íi]lia/, "DF"],
  [/manaus/, "AM"],
  [/bel[ée]m/, "PA"],
  [/goi[âa]nia/, "GO"],
  [/vit[óo]ria|vila velha/, "ES"],
  [/natal/, "RN"],
  [/s[ãa]o lu[íi]s/, "MA"],
  [/jo[ãa]o pessoa/, "PB"],
  [/macei[óo]/, "AL"],
  [/cuiab[áa]/, "MT"],
  [/campo grande/, "MS"],
  [/aracaju/, "SE"],
  [/teresina/, "PI"],
  [/palmas/, "TO"],
  [/porto velho/, "RO"],
  [/boa vista/, "RR"],
  [/macap[áa]/, "AP"],
  [/rio branco/, "AC"],
  [/\bsantar[ée]m\b/, "PA"],
  [/uberaba/, "MG"],
];

// nome de estado por extenso (quando o scraper não dá cidade nem sigla)
const STATE_UF: [RegExp, string][] = [
  [/mato grosso do sul/, "MS"],
  [/mato grosso/, "MT"],
  [/rio grande do sul/, "RS"],
  [/rio grande do norte/, "RN"],
  [/minas gerais/, "MG"],
  [/esp[íi]rito santo/, "ES"],
  [/santa catarina/, "SC"],
  [/distrito federal/, "DF"],
  [/amazonas/, "AM"],
  [/pernambuco/, "PE"],
  [/para[íi]ba/, "PB"],
  [/paran[áa]/, "PR"],
  [/maranh[ãa]o/, "MA"],
  [/piau[íi]/, "PI"],
  [/cear[áa]/, "CE"],
  [/rond[ôo]nia/, "RO"],
  [/roraima/, "RR"],
  [/sergipe/, "SE"],
  [/tocantins/, "TO"],
  [/alagoas/, "AL"],
  [/amap[áa]/, "AP"],
  [/bahia/, "BA"],
  [/goi[áa]s/, "GO"],
  [/\bpar[áa]\b/, "PA"],
  [/\bacre\b/, "AC"],
];

export function eventRegion(h: Regionable): string {
  const loc = h.location?.trim();
  if (!loc) return h.format === "online" ? "online" : "exterior";
  if (/^online$/i.test(loc)) return "online";
  // "Cidade, UF" — sigla no final é o sinal mais confiável
  const tail = /,\s*([a-z]{2})[\s./-]*$/i.exec(loc);
  if (tail && UFS.has(tail[1].toLowerCase())) return tail[1].toUpperCase();
  const low = loc.toLowerCase();
  for (const [re, uf] of CITY_UF) if (re.test(low)) return uf;
  for (const [re, uf] of STATE_UF) if (re.test(low)) return uf;
  if (/\bbrasil\b|\bbrazil\b/i.test(low)) return "brasil";
  return "exterior";
}

// ordem dos chips: UFs alfabéticas, depois os buckets não-estaduais
export function getRegions(events: Regionable[]): string[] {
  const set = new Set(events.map(eventRegion));
  const ufs = [...set].filter((r) => r.length === 2).sort();
  const rest = ["online", "brasil", "exterior"].filter((r) => set.has(r));
  return [...ufs, ...rest];
}
