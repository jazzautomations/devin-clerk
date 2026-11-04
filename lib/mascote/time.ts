import db from "@/lib/db";
import { hashMascote, svgDoBicho } from "@/lib/mascote/isometrico";
import { configFromSeed, resolveMascote } from "@/lib/mascote/semente";
import { NOME_MAX, type MascoteConfig, type Peca } from "@/lib/mascote/tipos";

// Bicho do time (spec 046, onda 4 — telao-e-bicho-do-time). O time não
// sorteia um bicho novo: ele é MONTADO com uma parte do bicho de cada
// integrante, pra que a vitrine do projeto tenha a cara de quem fez.
//
// Regra (determinística, sem random): integrantes ordenados por username;
// espécie do 1º, cor do 2º (ou do 1º quando o time tem um só), acessório do
// 3º (ou do 1º). O resto do config vem do 1º. Mesma composição = mesmo
// bicho, em qualquer processo e em qualquer ordem de consulta.
//
// A bandeira do time é uma Peca no encaixe 'mao' passada em extras — o
// motor (lib/mascote/voxel.ts) não muda por causa disto.

export type IntegranteDoTime = { username: string; config: MascoteConfig };

/**
 * Config do bicho do time. `integrantes` pode vir em qualquer ordem: a
 * ordenação por username acontece aqui dentro.
 */
export function teamConfig(integrantes: IntegranteDoTime[], nomeDoTime: string): MascoteConfig {
  const nome = nomeDoTime.trim().slice(0, NOME_MAX) || "time";
  const ordenados = [...integrantes].sort((a, b) => a.username.localeCompare(b.username, "pt-BR"));
  if (ordenados.length === 0) return { ...configFromSeed(0), nome };
  const [primeiro, segundo, terceiro] = ordenados;
  const base = primeiro.config;
  return {
    ...base,
    corPrincipal: (segundo ?? primeiro).config.corPrincipal,
    corDetalhe: (segundo ?? primeiro).config.corDetalhe,
    acessorio: (terceiro ?? primeiro).config.acessorio,
    nome,
  };
}

// ---------- bandeira ----------

// Fonte 3x5 do time na bandeira: o motor voxel não tem texto, então as
// iniciais são pintadas como bloco de voxel na face da bandeira. Só A-Z e
// 0-9 (o que aparece em nome de time); o resto vira um bloco cheio.
const FONTE: Record<string, string[]> = {
  A: [".#.", "#.#", "###", "#.#", "#.#"],
  B: ["##.", "#.#", "##.", "#.#", "##."],
  C: [".##", "#..", "#..", "#..", ".##"],
  D: ["##.", "#.#", "#.#", "#.#", "##."],
  E: ["###", "#..", "##.", "#..", "###"],
  F: ["###", "#..", "##.", "#..", "#.."],
  G: [".##", "#..", "#.#", "#.#", ".##"],
  H: ["#.#", "#.#", "###", "#.#", "#.#"],
  I: ["###", ".#.", ".#.", ".#.", "###"],
  J: ["..#", "..#", "..#", "#.#", ".#."],
  K: ["#.#", "#.#", "##.", "#.#", "#.#"],
  L: ["#..", "#..", "#..", "#..", "###"],
  M: ["#.#", "###", "###", "#.#", "#.#"],
  N: ["#.#", "###", "###", "###", "#.#"],
  O: [".#.", "#.#", "#.#", "#.#", ".#."],
  P: ["##.", "#.#", "##.", "#..", "#.."],
  Q: [".#.", "#.#", "#.#", "###", "..#"],
  R: ["##.", "#.#", "##.", "#.#", "#.#"],
  S: [".##", "#..", ".#.", "..#", "##."],
  T: ["###", ".#.", ".#.", ".#.", ".#."],
  U: ["#.#", "#.#", "#.#", "#.#", ".##"],
  V: ["#.#", "#.#", "#.#", "#.#", ".#."],
  W: ["#.#", "#.#", "###", "###", "#.#"],
  X: ["#.#", "#.#", ".#.", "#.#", "#.#"],
  Y: ["#.#", "#.#", ".#.", ".#.", ".#."],
  Z: ["###", "..#", ".#.", "#..", "###"],
  "0": ["###", "#.#", "#.#", "#.#", "###"],
  "1": [".#.", "##.", ".#.", ".#.", "###"],
  "2": ["##.", "..#", ".#.", "#..", "###"],
  "3": ["##.", "..#", ".#.", "..#", "##."],
  "4": ["#.#", "#.#", "###", "..#", "..#"],
  "5": ["###", "#..", "##.", "..#", "##."],
  "6": [".##", "#..", "##.", "#.#", ".#."],
  "7": ["###", "..#", ".#.", ".#.", ".#."],
  "8": [".#.", "#.#", ".#.", "#.#", ".#."],
  "9": [".#.", "#.#", ".##", "..#", "##."],
};

/** 1 ou 2 letras em maiúscula a partir do nome do time ("Time Alfa" → "TA") */
export function iniciaisDoTime(nome: string): string {
  const palavras = nome
    .trim()
    .split(/\s+/)
    .filter((p) => /[a-z0-9]/i.test(p));
  const letras = (palavras.length > 1 ? palavras.map((p) => p[0]) : [...(palavras[0] ?? "T")])
    .join("")
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase();
  return (letras || "T").slice(0, 2);
}

/** matriz da bandeira: as iniciais pintadas sobre o pano (fundo 'w') */
export function matrizBandeira(iniciais: string): string[] {
  const letras = [...iniciais.toUpperCase()].map((c) => FONTE[c] ?? FONTE.T);
  return [0, 1, 2, 3, 4].map((linha) => letras.map((g) => g[linha]).join("."));
}

/**
 * Bandeira do time: mastro + pano com as iniciais, no encaixe 'mao'
 * (normal +x). Vai em `extras`, que o motor desenha por último — a
 * bandeira cobre o item de mão do config, que é do indivíduo.
 *
 * Geometria: o pano fica na célula logo fora da mão (x = 0 no referencial
 * do encaixe), com 5 de altura e a largura das iniciais. As letras são
 * pintadas na face +x do pano, que é a que o telão vê.
 */
export function bandeiraPeca(iniciais: string): Peca {
  const letras = [...iniciais.toUpperCase()].slice(0, 2);
  const larg = Math.max(3, letras.length * 4 - 1);
  const matriz = matrizBandeira(iniciais);
  return {
    id: "bandeira-do-time",
    encaixe: "mao",
    cor: "detalhe",
    primitivas: [
      // mastro: sobe 8 células a partir da mão
      { tipo: "caixa", de: [0, 0, 0], ate: [0, 7, 0], cor: "#1d1d1f" },
      // pano: 5 de altura, largura das iniciais, uma célula de espessura
      { tipo: "caixa", de: [0, 3, 0], ate: [0, 7, -(larg - 1)], cor: "#fefefe" },
      {
        tipo: "pintura",
        matriz,
        cores: { "#": "#0c0c0c", w: "#fefefe" },
        // primeira coluna/linha da matriz cai no alto do pano, à direita
        ancora: [0, 4],
        em: [0, 3, 0],
      },
    ],
  };
}

// ---------- leitura do banco ----------

export type BichoDoTime = {
  teamId: number;
  teamName: string;
  /** config montado com as partes dos integrantes */
  config: MascoteConfig;
  /** mastro com as iniciais, no encaixe da mão */
  extras: Peca[];
  iniciais: string;
  /** quantos integrantes entraram na composição */
  integrantes: number;
  hash: string;
  src: string;
};

type TeamRow = { id: number; name: string; hackathonId: string };
type MemberRow = { id: number; username: string; mascote: string | null };

/**
 * Bicho do time montado a partir dos integrantes com perfil vinculado
 * (team_members guarda username). Time sem integrante vinculado cai no
 * bicho da semente do id 0 — nunca imagem quebrada.
 */
export async function bichoDoTime(teamId: number): Promise<BichoDoTime | null> {
  if (!Number.isSafeInteger(teamId) || teamId <= 0) return null;
  const team = await db.prepare("SELECT id, name, hackathonId FROM teams WHERE id = ?").get<TeamRow>(teamId);
  if (!team) return null;
  const membros = await db
    .prepare(
      `SELECT m.id, m.username, m.mascote
       FROM team_members tm JOIN members m ON m.username = tm.username
       WHERE tm.teamId = ?
       ORDER BY m.username`,
    )
    .all<MemberRow>(team.id);
  const config = teamConfig(
    membros.map((m) => ({ username: m.username, config: resolveMascote({ id: m.id, mascote: m.mascote }) })),
    team.name,
  );
  const iniciais = iniciaisDoTime(team.name);
  const extras = [bandeiraPeca(iniciais)];
  const hash = hashMascote(config, { extras });
  return {
    teamId: team.id,
    teamName: team.name,
    config,
    extras,
    iniciais,
    integrantes: membros.length,
    hash,
    src: `/api/mascote/time/${team.id}?v=${hash}`,
  };
}

/** SVG do bicho do time, com cache de arte do mesmo jeito que o do membro */
export async function svgDoTime(teamId: number): Promise<{ svg: string; hash: string; nome: string } | null> {
  const bicho = await bichoDoTime(teamId);
  if (!bicho) return null;
  const { svg, hash } = svgDoBicho(bicho.config, { extras: bicho.extras, titulo: bicho.teamName });
  return { svg, hash, nome: bicho.teamName };
}
