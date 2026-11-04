// dados puros do sistema de jogo — sem db, seguro pra client components
import type { FactKind } from "@/lib/evidence";

/**
 * XP por AÇÃO: aposentado (spec 046, nivel-por-entrega). Post, comentário,
 * curtida, inscrição, anúncio no mural de times e envio de time não dão mais
 * nada. As chaves ficam com 0 só pra não quebrar quem ainda importa; o awardXp
 * que sobrar soma 0 e o recompute do cron sobrescreve de qualquer jeito.
 */
export const XP = {
  post: 0,
  comment: 0,
  likeReceived: 0,
  register: 0,
  identidade: 0,
  teamBoard: 0,
  teamSubmit: 0,
} as const;

export type FactXp = { xp: number; one: string; many: string };

/**
 * XP por FATO verificado (lib/evidence.ts, com a regra antifarm de lá: edição
 * no HackaHub, 15+ check-ins, comunidade verificada, organizador não ganha
 * presença/entrega/prêmio na própria edição). members.xp = soma disto,
 * recalculada pelo cron /api/cron/xp (lib/xp.ts → recomputeAll).
 */
export const FACT_XP: Record<FactKind, FactXp> = {
  presenca: { xp: 30, one: "presença", many: "presenças" },
  entrega: { xp: 60, one: "entrega travada", many: "entregas travadas" },
  premio: { xp: 100, one: "prêmio", many: "prêmios" },
  voltou: { xp: 20, one: "retorno", many: "retornos" },
  mentoria: { xp: 40, one: "mentoria", many: "mentorias" },
  organizou: { xp: 80, one: "edição organizada", many: "edições organizadas" },
  duvida: { xp: 5, one: "dúvida respondida", many: "dúvidas respondidas" },
};

/** "2 presenças", "1 entrega travada" */
export function factLabel(kind: FactKind, count: number): string {
  const f = FACT_XP[kind];
  return `${count} ${count === 1 ? f.one : f.many}`;
}

export type Level = { n: number; name: string; min: number };

// A conta com FACT_XP: 1 edição com presença e entrega = 30 + 60 = 90
// (hacker). A segunda edição com entrega soma presença, retorno e entrega
// (30 + 20 + 60) = 200 (veterano). Prêmio (100) ou organização (80) puxam
// pra elite; lenda é anos de HackaHub.

export const LEVELS: Level[] = [
  { n: 1, name: "novato", min: 0 },
  { n: 2, name: "hacker", min: 50 },
  { n: 3, name: "veterano", min: 150 },
  { n: 4, name: "elite", min: 400 },
  { n: 5, name: "lenda", min: 1000 },
];

export function levelFor(xp: number): {
  level: Level;
  next: Level | null;
  progress: number;
} {
  let level = LEVELS[0];
  let next: Level | null = null;
  for (let i = 0; i < LEVELS.length; i++) {
    if (xp >= LEVELS[i].min) {
      level = LEVELS[i];
      next = LEVELS[i + 1] ?? null;
    }
  }
  const span = next ? next.min - level.min : 0;
  const progress = next ? Math.min(1, (xp - level.min) / span) : 1;
  return { level, next, progress };
}

export type Rarity = "comum" | "raro" | "epico" | "lendario";

export const RARITY_LABEL: Record<Rarity, string> = {
  comum: "comum",
  raro: "raro",
  epico: "épico",
  lendario: "lendário",
};

// classe tailwind de cor por raridade — tokens definidos no globals.css
export const RARITY_TEXT: Record<Rarity, string> = {
  comum: "text-muted",
  raro: "text-raro",
  epico: "text-epico",
  lendario: "text-lendario",
};

export const RARITY_BORDER: Record<Rarity, string> = {
  comum: "border-line",
  raro: "border-raro/60",
  epico: "border-epico/60",
  lendario: "border-lendario/60",
};

/** retired: não é mais concedida nem exibida (as linhas antigas ficam no banco) */
export type Badge = {
  id: string;
  name: string;
  desc: string;
  glyph: string;
  retired?: boolean;
  /** item do bicho que o selo destrava (spec 046, onda 4, lib/mascote/itens) */
  item?: string;
};

export const BADGES: Record<string, Badge> = {
  pioneiro: {
    id: "pioneiro",
    name: "pioneiro",
    desc: "um dos primeiros 50 membros da plataforma",
    glyph: "◆",
  },
  identidade: {
    id: "identidade",
    name: "identidade",
    desc: "perfil completo — bio, headline e skills",
    glyph: "▣",
  },
  debut: {
    id: "debut",
    name: "1ª campanha",
    desc: "inscreveu-se no primeiro hackathon",
    glyph: "▲",
  },
  veterano: {
    id: "veterano",
    name: "veterano",
    desc: "3+ hackathons no histórico",
    glyph: "⬢",
  },
  criador: {
    id: "criador",
    name: "criador",
    desc: "5+ posts na comunidade",
    glyph: "✎",
    retired: true,
  },
  influente: {
    id: "influente",
    name: "influente",
    desc: "10+ curtidas recebidas",
    glyph: "★",
    retired: true,
  },
  colecionador: {
    id: "colecionador",
    name: "colecionador",
    desc: "5+ cartinhas na coleção",
    glyph: "◈",
  },
  organizador: {
    id: "organizador",
    name: "organizador",
    desc: "organiza edições no HackaHub",
    glyph: "⬟",
  },
  // spec 046, onda 4: selos que vestem um item do bicho. Quem CONCEDE são as
  // features da onda 5 (quatro semanas, roda de encontros, time ponte); aqui
  // só ficam declarados, com o item que cada um destrava.
  "quatro-semanas": {
    id: "quatro-semanas",
    name: "quatro semanas",
    desc: "acompanhou o projeto nas 4 semanas depois do evento",
    glyph: "▦",
    item: "estrela",
  },
  roda: {
    id: "roda",
    name: "roda",
    desc: "participou de uma roda numa edição",
    glyph: "◉",
    item: "antena",
  },
  ponte: {
    id: "ponte",
    name: "ponte",
    desc: "fez time com gente de outra comunidade ou área",
    glyph: "⇄",
    item: "mapa",
  },
};

/** selos que vestem um item do bicho: badgeId → itemId (lib/mascote/itens) */
export function badgesComItem(): { id: string; item: string }[] {
  return Object.values(BADGES)
    .filter((b) => !!b.item && !b.retired)
    .map((b) => ({ id: b.id, item: b.item as string }));
}

/** ids aposentados: as linhas antigas ficam em member_badges, mas não contam
 *  em lugar nenhum (perfil, lista de membros) */
export const RETIRED_BADGE_IDS: readonly string[] = Object.values(BADGES)
  .filter((b) => b.retired)
  .map((b) => b.id);
