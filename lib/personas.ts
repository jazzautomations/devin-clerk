// Quem a pessoa é no ecossistema — lista fechada (filtro e chip dependem de
// valor conhecido). Módulo puro: usado no formulário (client) e na API.

export const PERSONAS = [
  { key: "dev", label: "desenvolvedor" },
  { key: "design", label: "design" },
  { key: "produto", label: "produto" },
  { key: "dados", label: "dados / IA" },
  { key: "empreendedor", label: "founder" },
  { key: "investidor", label: "investidor" },
  { key: "mentor", label: "mentor" },
  { key: "professor", label: "professor" },
  { key: "estudante", label: "estudante" },
  { key: "marca", label: "recrutador / marca" },
  { key: "organizador", label: "organizador" },
] as const;

export type PersonaKey = (typeof PERSONAS)[number]["key"];
export const MAX_PERSONAS = 4;

const KEYS = new Set<string>(PERSONAS.map((p) => p.key));

export function personaLabel(key: string | null | undefined): string | null {
  return PERSONAS.find((p) => p.key === key)?.label ?? null;
}

/** valida a lista vinda do cliente: chaves conhecidas, sem repetição, até 4 */
export function parsePersonas(input: unknown): { value: PersonaKey[] } | { error: string } {
  if (!Array.isArray(input)) return { error: "personas deve ser uma lista" };
  const out: PersonaKey[] = [];
  for (const v of input) {
    if (typeof v !== "string" || !KEYS.has(v)) return { error: `persona desconhecida: ${String(v)}` };
    if (!out.includes(v as PersonaKey)) out.push(v as PersonaKey);
  }
  if (out.length > MAX_PERSONAS) return { error: `escolhe até ${MAX_PERSONAS}` };
  return { value: out };
}
