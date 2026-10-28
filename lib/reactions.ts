// As 4 reações de post (migration 034). Módulo puro: o PostCard (client)
// importa daqui sem puxar o banco.

export const REACTION_KINDS = ["curti", "ajudou", "quero_testar", "aprendi"] as const;
export type ReactionKind = (typeof REACTION_KINDS)[number];

export const REACTION_LABEL: Record<ReactionKind, string> = {
  curti: "curti",
  ajudou: "ajudou",
  quero_testar: "quero testar",
  aprendi: "aprendi",
};

/** glifo ASCII de cada reação (sem emoji na UI) */
export const REACTION_GLYPH: Record<ReactionKind, string> = {
  curti: "+1",
  ajudou: "<3",
  quero_testar: ">_",
  aprendi: "!",
};

export function isReactionKind(v: unknown): v is ReactionKind {
  return typeof v === "string" && (REACTION_KINDS as readonly string[]).includes(v);
}
