// Áreas de ajuda do perfil (spec 046, perfil-rico, migration 041).
//
// "posso ajudar com" e "quero ajuda com" são um SUBCONJUNTO das chaves de
// PERSONAS (lib/personas.ts): nada de vocabulário paralelo. O rótulo aqui é
// o de ajuda, que não é sempre o de identidade ("empreendedor" vira "negócio
// e pitch" porque quem pede ajuda procura isso, não um cargo).
//
// Módulo puro: o formulário (client) e a API usam as mesmas funções.
//
// A vaga da Onda 3 usa estas mesmas chaves. `looking_for_team.need`
// (migration 001) é texto livre e continua assim: ele descreve o que o time
// precisa, não a área de quem oferece.

import { personaLabel } from "@/lib/personas";

export const AREA_KEYS = ["dev", "design", "produto", "dados", "empreendedor"] as const;
export type AreaKey = (typeof AREA_KEYS)[number];

/** quantas áreas por lado (oferece e quer) */
export const MAX_AREAS = 4;

const AREA_LABELS: Record<AreaKey, string> = {
  dev: "desenvolvimento",
  design: "design",
  produto: "produto",
  dados: "dados / IA",
  empreendedor: "negócio e pitch",
};

const KEYS = new Set<string>(AREA_KEYS);

export const isAreaKey = (v: unknown): v is AreaKey => typeof v === "string" && KEYS.has(v);

/** rótulo de ajuda; null pra chave desconhecida */
export function areaLabel(key: string | null | undefined): string | null {
  return isAreaKey(key) ? AREA_LABELS[key] : null;
}

/** rótulo de identidade (PERSONAS) — usado quando a área vem do perfil */
export function areaPersonaLabel(key: AreaKey): string | null {
  return personaLabel(key);
}

/** lista vinda do cliente: chaves conhecidas, sem repetição, até MAX_AREAS */
export function parseAreas(input: unknown): { value: AreaKey[] } | { error: string } {
  if (!Array.isArray(input)) return { error: "as áreas devem ser uma lista" };
  const out: AreaKey[] = [];
  for (const v of input) {
    if (!isAreaKey(v)) return { error: `área desconhecida: ${String(v)}` };
    if (!out.includes(v)) out.push(v);
  }
  if (out.length > MAX_AREAS) return { error: `escolha até ${MAX_AREAS} áreas` };
  return { value: out };
}

/**
 * Lê o JSON gravado em members.helpOffer/helpWant sem confiar no banco:
 * chave que não existe mais (ou JSON torto) é ignorada, repetida vira uma.
 */
export function areasFromJson(raw: string | null | undefined): AreaKey[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return [...new Set(parsed.filter(isAreaKey))].slice(0, MAX_AREAS);
}
