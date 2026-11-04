import type { CorRef, Encaixe, Peca, Primitiva } from "@/lib/mascote/tipos";

// Itens do bicho por FATO verificado (spec 046, onda 4, migration 047).
// O criador (migration 043) tem tudo liberado; estes 10 são extras que só
// aparecem com evidência — presença, entrega, prêmio, mentoria, organização,
// semanas construindo ou selo. Like, post, comentário e seguidor não destravam
// nada (lib/evidence.ts é a única fonte).
//
// Cada item é uma Peca avulsa: primitivas no referencial do encaixe (origem
// na célula logo fora da superfície, normal canônica: topo +y, peito +z,
// costas -z, mao +x). O motor (lib/mascote/voxel.ts) gira e posiciona, então
// nenhum item sabe em que espécie está.
//
// Limites da grade 16 (o teste cobre nas 8 espécies e nos 3 estágios):
// topo até 3 acima da origem, mao até 1 pra fora (+x), peito e costas até 1
// pra fora.

export const ITEM_IDS = [
  "cracha",
  "mochila",
  "medalha",
  "cachecol",
  "prancheta",
  "megafone",
  "broto",
  "estrela",
  "antena",
  "mapa",
] as const;

export type ItemId = (typeof ITEM_IDS)[number];

/** quantos itens aparecem no bicho ao mesmo tempo (o resto fica no armário) */
export const ITEM_MAX = 3;

export type ItemDef = {
  id: ItemId;
  nome: string;
  encaixe: Encaixe;
  /** o que a pessoa precisa fazer, no imperativo (aparece no item travado) */
  destrava: string;
  /** por que destravou, no passado (vai na notificação) */
  ganhou: string;
  cor: CorRef;
  primitivas: Primitiva[];
};

const OURO = "#e8b923";
const PAPEL = "#f2e2c4";

export const ITENS: Record<ItemId, ItemDef> = {
  cracha: {
    id: "cracha",
    nome: "crachá",
    encaixe: "peito",
    destrava: "faça check-in num hackathon",
    ganhou: "você fez check-in num hackathon",
    cor: "detalhe",
    primitivas: [
      { tipo: "caixa", de: [0, 2, 0], ate: [0, 3, 0], cor: "detalhe-escuro" },
      { tipo: "caixa", de: [-1, 0, 0], ate: [1, 1, 0], cor: "peca" },
      { tipo: "caixa", de: [-1, 1, 0], ate: [1, 1, 0], cor: "#fefefe" },
    ],
  },
  mochila: {
    id: "mochila",
    nome: "mochila",
    encaixe: "costas",
    destrava: "entregue um projeto travado",
    ganhou: "você entregou um projeto travado",
    cor: "#8a5a3b",
    primitivas: [
      { tipo: "caixa", de: [-2, 0, 0], ate: [2, 2, 1], cor: "peca" },
      { tipo: "caixa", de: [-1, 0, 1], ate: [1, 1, 1], cor: "detalhe" },
      { tipo: "caixa", de: [-2, 2, 0], ate: [2, 2, 0], cor: "detalhe-escuro" },
    ],
  },
  medalha: {
    id: "medalha",
    nome: "medalha",
    encaixe: "peito",
    destrava: "ganhe um prêmio do júri",
    ganhou: "você ganhou um prêmio do júri",
    cor: OURO,
    primitivas: [
      { tipo: "caixa", de: [-1, 2, 0], ate: [1, 2, 0], cor: "detalhe" },
      { tipo: "caixa", de: [0, 1, 0], ate: [0, 1, 0], cor: "detalhe" },
      { tipo: "caixa", de: [-1, -1, 0], ate: [1, 0, 0], cor: "peca" },
      { tipo: "pontos", pontos: [[0, -1, 1]], cor: "#fefefe" },
    ],
  },
  cachecol: {
    id: "cachecol",
    nome: "cachecol",
    encaixe: "peito",
    destrava: "participe de 2 edições",
    ganhou: "você participou de 2 edições",
    cor: "detalhe",
    primitivas: [
      { tipo: "caixa", de: [-2, 1, 0], ate: [2, 2, 0], cor: "peca" },
      { tipo: "caixa", de: [-2, 0, 0], ate: [2, 0, 0], cor: "peca" },
      { tipo: "caixa", de: [-2, -1, 0], ate: [-1, -1, 0], cor: "peca" },
      { tipo: "pontos", pontos: [[-2, -1, 1]], cor: "detalhe-escuro" },
    ],
  },
  prancheta: {
    id: "prancheta",
    nome: "prancheta",
    encaixe: "mao",
    destrava: "seja mentor, jurado ou staff de uma edição",
    ganhou: "você foi mentor, jurado ou staff de uma edição",
    cor: "#b07a4f",
    primitivas: [
      { tipo: "caixa", de: [0, -1, -1], ate: [0, 1, 1], cor: "peca" },
      { tipo: "caixa", de: [1, -1, -1], ate: [1, 1, 1], cor: "#fefefe" },
      { tipo: "caixa", de: [1, 1, -1], ate: [1, 1, 0], cor: "#3a3c40" },
      { tipo: "caixa", de: [1, 0, -1], ate: [1, 0, 1], cor: "#3a3c40" },
    ],
  },
  megafone: {
    id: "megafone",
    nome: "megafone",
    encaixe: "mao",
    destrava: "organize uma edição no HackaHub",
    ganhou: "você organizou uma edição no HackaHub",
    cor: "#d94f2b",
    primitivas: [
      { tipo: "caixa", de: [0, 0, -1], ate: [0, 1, 1], cor: "peca" },
      { tipo: "caixa", de: [1, 0, -2], ate: [1, 1, 2], cor: "peca" },
      { tipo: "pontos", pontos: [[1, 0, 3]], cor: "#fefefe" },
    ],
  },
  broto: {
    id: "broto",
    nome: "broto",
    encaixe: "topo",
    destrava: "construa por 4 semanas seguidas",
    ganhou: "você construiu por 4 semanas seguidas",
    cor: "#5ec46f",
    primitivas: [
      { tipo: "caixa", de: [0, 0, 0], ate: [0, 1, 0], cor: "#3f8c4f" },
      { tipo: "caixa", de: [-1, 2, 0], ate: [1, 2, 0], cor: "peca" },
      { tipo: "pontos", pontos: [[0, 3, 0]], cor: "#5ec46f" },
    ],
  },
  estrela: {
    id: "estrela",
    nome: "estrela",
    encaixe: "topo",
    destrava: "acompanhe um projeto nas 4 semanas depois do evento",
    ganhou: "você acompanhou um projeto nas 4 semanas depois do evento",
    cor: OURO,
    primitivas: [
      { tipo: "pontos", pontos: [[0, 0, 0], [0, 1, 0], [0, 2, 0]], cor: "peca" },
      { tipo: "pontos", pontos: [[-1, 1, 0], [1, 1, 0], [0, 1, -1], [0, 1, 1]], cor: "peca" },
      { tipo: "pontos", pontos: [[0, 3, 0]], cor: "#fefefe" },
    ],
  },
  antena: {
    id: "antena",
    nome: "antena",
    encaixe: "topo",
    destrava: "participe de uma roda numa edição",
    ganhou: "você participou de uma roda numa edição",
    cor: "#a3a8ae",
    primitivas: [
      { tipo: "caixa", de: [0, 0, 0], ate: [0, 2, 0], cor: "peca" },
      { tipo: "caixa", de: [-1, 1, 0], ate: [1, 1, 0], cor: "peca" },
      { tipo: "caixa", de: [0, 3, 0], ate: [0, 3, 0], cor: "#ba3919" },
    ],
  },
  mapa: {
    id: "mapa",
    nome: "mapa",
    encaixe: "mao",
    destrava: "faça time com gente de outra comunidade ou área",
    ganhou: "você fez time com gente de outra comunidade ou área",
    cor: PAPEL,
    primitivas: [
      { tipo: "caixa", de: [0, -1, -1], ate: [1, 1, 1], cor: "peca" },
      { tipo: "caixa", de: [1, 1, -1], ate: [1, 1, 1], cor: "#e0c9a6" },
      { tipo: "pontos", pontos: [[1, 0, 0]], cor: "#ba3919" },
      { tipo: "pontos", pontos: [[1, -1, 1]], cor: "#047a43" },
    ],
  },
};

export function ehItemId(v: unknown): v is ItemId {
  return typeof v === "string" && (ITEM_IDS as readonly string[]).includes(v);
}

/** a peça que o motor monta: mesma geometria, id do item */
export function pecaItem(id: ItemId): Peca {
  const def = ITENS[id];
  return { id: def.id, encaixe: def.encaixe, cor: def.cor, primitivas: def.primitivas };
}

/** ids válidos, sem repetição, na ordem do catálogo (máximo ITEM_MAX) */
export function normalizarItens(raw: unknown): ItemId[] {
  if (!Array.isArray(raw)) return [];
  const out: ItemId[] = [];
  for (const v of raw) {
    if (!ehItemId(v) || out.includes(v)) continue;
    out.push(v);
    if (out.length === ITEM_MAX) break;
  }
  return out;
}

export function nomeItem(id: ItemId): string {
  return ITENS[id].nome;
}

/** catálogo com o estado de cada item (o editor mostra o que destrava) */
export type ItemEstado = {
  id: ItemId;
  nome: string;
  destrava: string;
  unlocked: boolean;
};
