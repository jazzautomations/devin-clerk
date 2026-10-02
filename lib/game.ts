// dados puros do sistema de jogo — sem db, seguro pra client components

export const XP = {
  post: 10,
  comment: 5,
  likeReceived: 5,
  register: 50,
  identidade: 25,
} as const;

export type Level = { n: number; name: string; min: number };

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

export type Badge = { id: string; name: string; desc: string; glyph: string };

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
  },
  influente: {
    id: "influente",
    name: "influente",
    desc: "10+ curtidas recebidas",
    glyph: "★",
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
    desc: "organiza sessões hack inova",
    glyph: "⬟",
  },
};
