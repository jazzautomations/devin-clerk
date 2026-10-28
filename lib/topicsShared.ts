// Parte pura dos tópicos da comunidade (migration 058): tipos, limites,
// rótulos, ranking "em alta" e datas. Sem banco: roda no client também.
// lib/topics.ts reexporta tudo daqui.

export const TOPIC_KINDS = ["discussao", "pergunta", "enquete", "mostra"] as const;
export type TopicKind = (typeof TOPIC_KINDS)[number];
export const TOPIC_KIND_LABEL: Record<TopicKind, string> = {
  discussao: "discussão",
  pergunta: "pergunta",
  enquete: "enquete",
  mostra: "mostra o que fez",
};

export const TOPIC_LIMITS = {
  titleMin: 5,
  title: 140,
  body: 10000,
  flair: 24,
  reply: 5000,
  pollMin: 2,
  pollMax: 6,
  pollLabel: 80,
  depth: 6,
  pinned: 3,
  q: 80,
} as const;

export const TOPIC_SORTS = ["em-alta", "novos", "top", "sem-resposta"] as const;
export type TopicSort = (typeof TOPIC_SORTS)[number];
export const TOPIC_SORT_LABEL: Record<TopicSort, string> = {
  "em-alta": "em alta",
  novos: "novos",
  top: "mais votados",
  "sem-resposta": "sem resposta",
};
export const TOP_PERIODS = ["semana", "mes", "sempre"] as const;
export type TopPeriod = (typeof TOP_PERIODS)[number];
export const TOP_PERIOD_LABEL: Record<TopPeriod, string> = { semana: "semana", mes: "mês", sempre: "sempre" };
export const REPLY_SORTS = ["melhores", "novas"] as const;
export type ReplySort = (typeof REPLY_SORTS)[number];

/** quantos tópicos recentes entram no cálculo de "em alta" */
export const HOT_POOL = 200;

export const parseSort = (v: unknown): TopicSort =>
  typeof v === "string" && (TOPIC_SORTS as readonly string[]).includes(v) ? (v as TopicSort) : "em-alta";
export const parsePeriod = (v: unknown): TopPeriod =>
  typeof v === "string" && (TOP_PERIODS as readonly string[]).includes(v) ? (v as TopPeriod) : "semana";
export const parseReplySort = (v: unknown): ReplySort => (v === "novas" ? "novas" : "melhores");

// ---------- ranking (puro) ----------

/** datas do banco são TEXT "YYYY-MM-DD HH:MM:SS" em UTC */
export function parseDbTime(s: string): Date {
  return new Date(`${s.replace(" ", "T")}${/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? "" : "Z"}`);
}

/**
 * "Em alta", estilo Reddit adaptado: sinal(score)·log10(max(|score|,1)) e
 * menos 1 ponto a cada 12 horas de idade. Dez votos valem 12 horas; um
 * tópico novo sem voto passa um de ontem com 10 votos.
 */
export function hotScore(score: number, createdAt: string | Date, now: Date): number {
  const created = typeof createdAt === "string" ? parseDbTime(createdAt) : createdAt;
  const ageHours = Math.max(0, (now.getTime() - created.getTime()) / 3_600_000);
  const order = Math.log10(Math.max(Math.abs(score), 1));
  return Math.sign(score) * order - ageHours / 12;
}

/** ordena por hotScore (desempate: mais novo, depois maior id) sem mexer no array */
export function rankHot<T extends { id: number; score: number; createdAt: string }>(items: T[], now: Date): T[] {
  return items
    .map((t) => ({ t, h: hotScore(t.score, t.createdAt, now), c: parseDbTime(t.createdAt).getTime() }))
    .sort((a, b) => b.h - a.h || b.c - a.c || b.t.id - a.t.id)
    .map((x) => x.t);
}

/** "agora", "há 5 min", "há 3 h", "há 2 d"; mais de 30 dias vira data */
export function timeAgo(s: string, now = new Date()): string {
  const d = parseDbTime(s);
  const min = Math.floor((now.getTime() - d.getTime()) / 60_000);
  if (Number.isNaN(min)) return s;
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const days = Math.floor(h / 24);
  if (days <= 30) return `há ${days} d`;
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric", timeZone: "America/Sao_Paulo" })
    .format(d)
    .replace(".", "");
}

export const topicHref = (slug: string, topicId: number, replyId?: number | null) =>
  `/comunidade/${slug}/t/${topicId}${replyId ? `#r-${replyId}` : ""}`;
