// whitelist de interesse comercial — módulo puro (sem db), seguro pra client
// components (mesmo contrato de lib/openTo.ts). Contrato fechado: novos
// valores entram por aqui, nunca por texto solto; "outro" + message cobre o resto.

export const LEAD_INTERESTS = [
  "desafio",
  "edicao",
  "talento",
  "outro",
] as const;

export type LeadInterest = (typeof LEAD_INTERESTS)[number];

export const LEAD_INTEREST_LABELS: Record<LeadInterest, string> = {
  desafio: "desafio patrocinado",
  edicao: "patrocínio de edição",
  talento: "talento",
  outro: "outro",
};

export function isLeadInterest(v: unknown): v is LeadInterest {
  return (
    typeof v === "string" &&
    (LEAD_INTERESTS as readonly string[]).includes(v)
  );
}
