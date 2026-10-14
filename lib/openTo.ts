// whitelist de "disponível para" (open to) — módulo puro (sem db), seguro pra client components
// (mesmo contrato de lib/game.ts). É contrato comercial fechado, não tag
// livre: novos valores entram por aqui, nunca por texto solto.

export const OPEN_TO = ["trampo", "cofundador", "freela", "mentoria"] as const;

export type OpenToValue = (typeof OPEN_TO)[number];

/** rótulo na tela; o valor salvo continua o mesmo ("trampo" vira "emprego") */
export const OPEN_TO_LABEL: Record<OpenToValue, string> = {
  trampo: "emprego",
  cofundador: "cofundador",
  freela: "freela",
  mentoria: "mentoria",
};

export function openToLabel(v: string): string {
  return isOpenToValue(v) ? OPEN_TO_LABEL[v] : v;
}

export function isOpenToValue(v: unknown): v is OpenToValue {
  return typeof v === "string" && (OPEN_TO as readonly string[]).includes(v);
}

/** "trampo, freela" → ["trampo","freela"]; null/""/lixo → só valores válidos */
export function parseOpenTo(raw: string | null | undefined): OpenToValue[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is OpenToValue => isOpenToValue(s));
}
