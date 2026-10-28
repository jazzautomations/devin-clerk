// Tipos de apoio a uma comunidade (migration 028) — módulo puro (sem db),
// seguro pra client components. Apoio não é só dinheiro: espaço, comida,
// prêmio, mentoria e divulgação contam igual. Contrato fechado; "outro" +
// descrição cobre o resto.

export const SUPPORT_KINDS = ["dinheiro", "espaco", "comida", "premio", "mentoria", "divulgacao", "outro"] as const;

export type SupportKind = (typeof SUPPORT_KINDS)[number];

export const SUPPORT_KIND_LABELS: Record<SupportKind, string> = {
  dinheiro: "dinheiro",
  espaco: "espaço",
  comida: "comida",
  premio: "prêmio",
  mentoria: "mentoria",
  divulgacao: "divulgação",
  outro: "outro",
};

export function isSupportKind(v: unknown): v is SupportKind {
  return typeof v === "string" && (SUPPORT_KINDS as readonly string[]).includes(v);
}
