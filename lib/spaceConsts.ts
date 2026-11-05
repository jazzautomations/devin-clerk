// Constantes e tipos dos espaços compartilhados entre servidor e cliente
// (componentes "use client" não podem puxar communitySpaces, que fala com
// o banco). Migration 057.

export const SPACE_LIMITS = { name: 40, description: 200, active: 8 } as const;
export const SPACE_SLUG_RE = /^[a-z0-9-]{2,30}$/;
/** o espaço que recebe post sem espaço e de onde nada se muda */
export const DEFAULT_SPACE = "geral";
export const SPACE_POLICIES = ["membros", "organizacao"] as const;
export type SpacePolicy = (typeof SPACE_POLICIES)[number];
export const SPACE_POLICY_LABEL: Record<SpacePolicy, string> = {
  membros: "todo mundo posta",
  organizacao: "só a organização posta",
};

export type CommunitySpace = {
  id: number;
  communityId: number;
  slug: string;
  name: string;
  description: string | null;
  postPolicy: SpacePolicy;
  position: number;
  archivedAt: string | null;
  createdAt: string;
};
