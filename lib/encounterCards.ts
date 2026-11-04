// Cartas de conversa do encontro (spec 046, onda 5; perguntas da spec 045).
//
// Módulo PURO (sem banco, sem Node): a tela usa as mesmas cartas que a API
// valida. Nada de nome, eixo ou regra do quebra-gelo que inspirou a ideia:
// aqui são cartas de conversa, e o encontro é leve — a carta é sugestão de
// assunto, nunca etapa obrigatória.
//
// Três famílias, na ordem em que a conversa acontece:
// - abrir: o primeiro minuto;
// - funda: quando já tem assunto;
// - time: quando a conversa pode virar projeto.

export const CARD_KINDS = ["abrir", "funda", "time"] as const;
export type CardKind = (typeof CARD_KINDS)[number];

export const CARD_KIND_LABEL: Record<CardKind, string> = {
  abrir: "pra abrir",
  funda: "mais fundo",
  time: "sobre time",
};

export type EncounterCard = { key: string; kind: CardKind; text: string };

export const ENCOUNTER_CARDS: EncounterCard[] = [
  { key: "abrir-stack", kind: "abrir", text: "Que stack você usaria pra um app em 24h?" },
  { key: "abrir-trouxe", kind: "abrir", text: "O que te trouxe nesse hackathon?" },
  { key: "abrir-desafio", kind: "abrir", text: "Qual desafio você tá de olho?" },
  { key: "funda-bug", kind: "funda", text: "Pior bug da sua vida?" },
  { key: "funda-ideia", kind: "funda", text: "A ideia maluca que não sai da cabeça?" },
  { key: "funda-aprender", kind: "funda", text: "O que você quer aprender até domingo?" },
  {
    key: "funda-problema",
    kind: "funda",
    text: "Qual problema da sua faculdade ou cidade você resolveria?",
  },
  { key: "time-falta", kind: "time", text: "Se o time fosse nós dois, o que falta?" },
  { key: "time-ideia", kind: "time", text: "Você prefere ideia própria ou entrar na de alguém?" },
];

const BY_KEY = new Map(ENCOUNTER_CARDS.map((c) => [c.key, c]));

/** carta pela chave; null pra chave desconhecida (o banco não decide a UI) */
export function cardByKey(key: string | null | undefined): EncounterCard | null {
  return key ? (BY_KEY.get(key) ?? null) : null;
}

export function cardsOf(kind: CardKind): EncounterCard[] {
  return ENCOUNTER_CARDS.filter((c) => c.kind === kind);
}

/** a carta sugerida pra cada momento, sem repetir entre os dois lados */
export function suggestedCard(kind: CardKind, seed = 0): EncounterCard {
  const list = cardsOf(kind);
  return list[Math.abs(Math.trunc(seed)) % list.length];
}

export function isCardKey(v: unknown): v is string {
  return typeof v === "string" && BY_KEY.has(v);
}

/** texto da carta escolhida, pro cartão do encontro ("abrimos com: …") */
export function cardText(key: string | null | undefined): string | null {
  return cardByKey(key)?.text ?? null;
}
