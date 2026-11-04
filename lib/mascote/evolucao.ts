import db from "@/lib/db";
import { buildWeeks } from "@/lib/buildWeeks";
import { factsFor, type FactKind } from "@/lib/evidence";
import { notify } from "@/lib/notifications";
import { hashMascote } from "@/lib/mascote/isometrico";
import { ITENS, ITEM_IDS, ITEM_MAX, nomeItem, normalizarItens, pecaItem, type ItemEstado, type ItemId } from "@/lib/mascote/itens";
import { mascoteDoMembro } from "@/lib/mascote/store";
import type { Estagio, MascoteConfig, Peca } from "@/lib/mascote/tipos";

// Evolução do bicho por FATO verificado (spec 046, onda 4, migration 047).
//
// Estágio e itens saem só de lib/evidence.ts (countFacts/factsFor), das
// semanas construindo (lib/buildWeeks.ts) e dos selos com item (lib/game.ts).
// Like, post, comentário, repost e seguidor NÃO destravam nada: quem destrava
// é o staff no check-in, o júri, o time que travou a entrega, o organizador
// da edição e o próprio tempo.
//
// O bicho aparece em toda lista através de members."avatarUrl" (uma URL só),
// então o hash de itens+estágio entra na URL (?e=…&i=…&v=…): quando o fato
// muda, syncUnlocks regrava o avatarUrl e a lista seguinte já mostra o bicho
// novo, sem query nova em feed, comentário, /membros ou inscritos.

/** quem manda no avatar: a foto do Clerk ou o bicho */
export type AvatarKind = "foto" | "bicho";

export const ESTAGIO_NOME: Record<Estagio, string> = {
  filhote: "filhote",
  jovem: "jovem",
  adulto: "adulto",
};

export const ESTAGIO_DESC: Record<Estagio, string> = {
  filhote: "ainda não tem fato verificado",
  jovem: "de 1 a 3 fatos verificados",
  adulto: "4 fatos ou mais",
};

/** puro: 0 fato = filhote, 1 a 3 = jovem, 4+ = adulto (spec 046) */
export function estagioPorFatos(fatos: number): Estagio {
  if (!Number.isFinite(fatos) || fatos <= 0) return "filhote";
  return fatos < 4 ? "jovem" : "adulto";
}

export type Contexto = {
  /** contagem por tipo de fato */
  fatos: Record<FactKind, number>;
  /** data do fato mais recente de cada tipo ("YYYY-MM-DD HH:MM:SS") */
  ultimo: Partial<Record<FactKind, string>>;
  total: number;
  semanas: { total: number; sequencia: number };
  /** badgeId → quando foi concedido */
  badges: Map<string, string>;
};

/** o mais recente entre as datas passadas ("" quando não há nenhuma) */
const maisRecente = (...xs: (string | undefined)[]) =>
  xs.filter((x): x is string => !!x).sort().at(-1) ?? "";

const ultimaSemana = (c: Contexto) =>
  maisRecente(c.ultimo.presenca, c.ultimo.entrega, c.ultimo.duvida, c.ultimo.mentoria, c.ultimo.organizou, c.ultimo.premio);

/** o que destrava cada item, em função dos fatos (puro) */
const DESTRAVA: Record<ItemId, (c: Contexto) => boolean> = {
  cracha: (c) => c.fatos.presenca >= 1,
  mochila: (c) => c.fatos.entrega >= 1,
  medalha: (c) => c.fatos.premio >= 1,
  cachecol: (c) => c.fatos.presenca >= 2,
  prancheta: (c) => c.fatos.mentoria >= 1,
  megafone: (c) => c.fatos.organizou >= 1,
  broto: (c) => c.semanas.sequencia >= 4,
  estrela: (c) => c.badges.has("quatro-semanas"),
  antena: (c) => c.badges.has("roda"),
  mapa: (c) => c.badges.has("ponte"),
};

/** quando o item destravou, pra ordenar "os mais recentes" (puro) */
const QUANDO: Record<ItemId, (c: Contexto) => string> = {
  cracha: (c) => c.ultimo.presenca ?? "",
  mochila: (c) => c.ultimo.entrega ?? "",
  medalha: (c) => c.ultimo.premio ?? "",
  cachecol: (c) => c.ultimo.presenca ?? "",
  prancheta: (c) => c.ultimo.mentoria ?? "",
  megafone: (c) => c.ultimo.organizou ?? "",
  broto: (c) => ultimaSemana(c),
  estrela: (c) => c.badges.get("quatro-semanas") ?? "",
  antena: (c) => c.badges.get("roda") ?? "",
  mapa: (c) => c.badges.get("ponte") ?? "",
};

async function contexto(memberId: number): Promise<Contexto> {
  const [facts, semanas, badges] = await Promise.all([
    factsFor(memberId),
    buildWeeks(memberId),
    db
      .prepare("SELECT badgeId, awardedAt FROM member_badges WHERE memberId = ?")
      .all<{ badgeId: string; awardedAt: string }>(memberId),
  ]);
  const fatos: Record<FactKind, number> = {} as Record<FactKind, number>;
  const ultimo: Partial<Record<FactKind, string>> = {};
  for (const f of facts) {
    fatos[f.kind] = (fatos[f.kind] ?? 0) + 1;
    ultimo[f.kind] = maisRecente(ultimo[f.kind], f.at);
  }
  const mapa = new Map(badges.map((b) => [b.badgeId, b.awardedAt]));
  return { fatos, ultimo, total: facts.length, semanas, badges: mapa };
}

/** itens que o fato destravou, do mais recente pro mais antigo (puro) */
export function itensDestravados(c: Contexto): ItemId[] {
  return ITEM_IDS.filter((id) => DESTRAVA[id](c)).sort(
    (a, b) => QUANDO[b](c).localeCompare(QUANDO[a](c)) || ITEM_IDS.indexOf(a) - ITEM_IDS.indexOf(b),
  );
}

/** itens que a pessoa destravou (mais recente primeiro) */
export async function unlockedItems(memberId: number): Promise<ItemId[]> {
  return itensDestravados(await contexto(memberId));
}

/** estágio do bicho e quantos fatos verificados ele tem */
export async function estagioDoMembro(memberId: number): Promise<{ estagio: Estagio; fatos: number }> {
  const c = await contexto(memberId);
  return { estagio: estagioPorFatos(c.total), fatos: c.total };
}

/** os itens que a pessoa escolheu (migration 047), na ordem salva */
export async function itensEscolhidos(memberId: number): Promise<ItemId[]> {
  const row = await db
    .prepare("SELECT mascoteItens FROM members WHERE id = ?")
    .get<{ mascoteItens: string | null }>(memberId);
  if (!row?.mascoteItens) return [];
  try {
    return normalizarItens(JSON.parse(row.mascoteItens));
  } catch {
    return [];
  }
}

/** catálogo com o estado de cada item (o editor mostra o que destrava) */
export async function itemEstados(memberId: number): Promise<ItemEstado[]> {
  const unlocked = new Set(await unlockedItems(memberId));
  return ITEM_IDS.map((id) => ({
    id,
    nome: ITENS[id].nome,
    destrava: ITENS[id].destrava,
    unlocked: unlocked.has(id),
  }));
}

export type BichoDoMembro = {
  config: MascoteConfig;
  /** false = bicho da semente (a pessoa ainda não montou) */
  salvo: boolean;
  atualizadoEm: string | null;
  estagio: Estagio;
  /** fatos verificados que o bicho tem */
  fatos: number;
  /** os itens que aparecem no bicho (até 3) */
  itens: ItemId[];
  /** tudo que o fato já destravou */
  unlocked: ItemId[];
  /** os que a pessoa escolheu em /perfil (interseção com unlocked) */
  escolhidos: ItemId[];
  pecas: Peca[];
  hash: string;
  src: string;
  semanas: { total: number; sequencia: number };
};

/** URL do bicho na rota pública: estágio e itens vão na query, o hash fecha tudo */
export function avatarDoBicho(
  memberId: number,
  config: MascoteConfig,
  itens: readonly ItemId[],
  estagio: Estagio,
): { hash: string; src: string } {
  const hash = hashMascote(config, { itens: itens.map(pecaItem), estagio });
  const q = [`e=${estagio}`];
  if (itens.length) q.push(`i=${itens.join(",")}`);
  q.push(`v=${hash}`);
  return { hash, src: `/api/mascote/m/${memberId}?${q.join("&")}` };
}

/** o bicho completo: config, estágio, itens destravados e os exibidos */
export async function bichoDoMembro(memberId: number): Promise<BichoDoMembro> {
  const [mascote, c, escolhidos] = await Promise.all([
    mascoteDoMembro(memberId),
    contexto(memberId),
    itensEscolhidos(memberId),
  ]);
  const unlocked = itensDestravados(c);
  const escolhidosValidos = escolhidos.filter((id) => unlocked.includes(id));
  // sem escolha (ou com escolha vazia) valem os mais recentes
  const itens = (escolhidosValidos.length ? escolhidosValidos : unlocked).slice(0, ITEM_MAX);
  const estagio = estagioPorFatos(c.total);
  const { hash, src } = avatarDoBicho(memberId, mascote.config, itens, estagio);
  return {
    config: mascote.config,
    salvo: mascote.salvo,
    atualizadoEm: mascote.atualizadoEm,
    estagio,
    fatos: c.total,
    itens,
    unlocked,
    escolhidos: escolhidosValidos,
    pecas: itens.map(pecaItem),
    hash,
    src,
    semanas: c.semanas,
  };
}

/**
 * Regrava members."avatarUrl" quando o bicho mudou (itens, estágio ou config).
 * Quem usa a foto do Clerk não é tocado. Devolve o estado final do avatar.
 */
export async function regravarAvatar(
  memberId: number,
): Promise<{ avatarKind: AvatarKind; avatarUrl: string | null }> {
  const row = await db
    .prepare(`SELECT avatarKind, avatarUrl FROM members WHERE id = ?`)
    .get<{ avatarKind: string | null; avatarUrl: string | null }>(memberId);
  if (!row) return { avatarKind: "foto", avatarUrl: null };
  if (row.avatarKind !== "bicho") return { avatarKind: "foto", avatarUrl: row.avatarUrl };
  const bicho = await bichoDoMembro(memberId);
  if (row.avatarUrl !== bicho.src) {
    await db.prepare("UPDATE members SET avatarUrl = ? WHERE id = ?").run(bicho.src, memberId);
  }
  return { avatarKind: "bicho", avatarUrl: bicho.src };
}

export type SyncUnlocks = {
  /** itens destravados agora pela primeira vez */
  novos: ItemId[];
  estagio: Estagio;
  /** o avatarUrl do bicho foi regravado */
  avatarAtualizado: boolean;
};

/**
 * Fecha o ciclo do fato: registra o item novo (mascote_unlocks, uma vez),
 * notifica e, pra quem usa o bicho como avatar, regrava o avatarUrl com o
 * hash novo. Chamado pelo cron /api/cron/xp depois do recompute do xp.
 */
export async function syncUnlocks(memberId: number): Promise<SyncUnlocks> {
  const bicho = await bichoDoMembro(memberId);
  const novos: ItemId[] = [];
  for (const id of bicho.unlocked) {
    const res = await db
      .prepare("INSERT INTO mascote_unlocks (memberId, itemId) VALUES (?, ?) ON CONFLICT DO NOTHING")
      .run(memberId, id);
    if (res.changes > 0) novos.push(id);
  }
  for (const id of novos) {
    await notify(memberId, {
      type: "mascote_item",
      text: `Seu bicho ganhou ${nomeItem(id)}: ${ITENS[id].ganhou}`,
      href: "/perfil#bicho",
    });
  }
  const row = await db
    .prepare(`SELECT avatarKind, avatarUrl FROM members WHERE id = ?`)
    .get<{ avatarKind: string | null; avatarUrl: string | null }>(memberId);
  let avatarAtualizado = false;
  if (row?.avatarKind === "bicho" && row.avatarUrl !== bicho.src) {
    await db.prepare("UPDATE members SET avatarUrl = ? WHERE id = ?").run(bicho.src, memberId);
    avatarAtualizado = true;
  }
  return { novos, estagio: bicho.estagio, avatarAtualizado };
}

export const SYNC_BATCH = 200;

/**
 * syncUnlocks pra quem pode ter fato, item ou selo: usa o bicho como avatar,
 * tem xp, tem selo ou constrói em time. Quem não tem nada disso não tem o que
 * destravar. Em lotes de SYNC_BATCH, do menor id pro maior.
 */
export async function syncAllUnlocks(
  batch = SYNC_BATCH,
): Promise<{ scanned: number; avatares: number; itens: number }> {
  const candidatos = `
    SELECT m.id AS id FROM members m
    WHERE m.id > ? AND (
      m.avatarKind = 'bicho'
      OR m.xp > 0
      OR EXISTS (SELECT 1 FROM member_badges mb WHERE mb.memberId = m.id)
      OR EXISTS (SELECT 1 FROM posts p WHERE p.memberId = m.id AND p.teamId IS NOT NULL))
    ORDER BY m.id LIMIT ?`;
  let after = 0;
  let scanned = 0;
  let avatares = 0;
  let itens = 0;
  for (;;) {
    const ids = await db.prepare(candidatos).all<{ id: number }>(after, batch);
    if (!ids.length) break;
    for (const { id } of ids) {
      const r = await syncUnlocks(id);
      if (r.avatarAtualizado) avatares++;
      itens += r.novos.length;
    }
    scanned += ids.length;
    after = ids[ids.length - 1].id;
  }
  return { scanned, avatares, itens };
}
