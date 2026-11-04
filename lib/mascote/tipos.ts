import type { CorId } from "@/lib/mascote/paleta";

// Bicho do builder (migration 043): o que a pessoa escolhe no criador.
// Tudo liberado desde o começo. Item que vem de fato verificado (presença,
// entrega, prêmio) é extra e chega por montar(config, {itens}) na onda 4,
// sem mexer neste arquivo.

export const ESPECIES = ["cracha", "teclado", "pizza", "servidor", "patinho", "mouse", "cafe", "foguete"] as const;
export const OLHOS = ["ponto", "feliz", "sono", "brilho", "piscadinha", "surpreso"] as const;
export const BOCAS = ["sorriso", "risada", "reta", "lingua", "gato"] as const;
export const TOPOS = ["nada", "bone", "gorro", "cartola", "coroa", "helice", "capacete", "laco"] as const;
export const ROUPAS = ["nada", "gravata", "borboleta", "bandana", "suspensorio", "logo"] as const;
export const MAOS = ["nada", "caneca", "notebook", "lapis", "chave", "balao"] as const;
export const ACESSORIOS = ["nada", "oculos", "oculos-escuros", "monoculo", "fone"] as const;
export const POSES = ["pula", "acena", "danca"] as const;
export const CENARIOS = ["nada", "mesa-de-hackathon", "palco", "servidor-rack"] as const;
export const ESTAGIOS = ["filhote", "jovem", "adulto"] as const;
export const ENCAIXES = ["topo", "olhos", "peito", "costas", "mao"] as const;

export type Especie = (typeof ESPECIES)[number];
export type Olhos = (typeof OLHOS)[number];
export type Boca = (typeof BOCAS)[number];
export type Topo = (typeof TOPOS)[number];
export type Roupa = (typeof ROUPAS)[number];
export type Mao = (typeof MAOS)[number];
export type Acessorio = (typeof ACESSORIOS)[number];
export type Pose = (typeof POSES)[number];
export type Cenario = (typeof CENARIOS)[number];
export type Estagio = (typeof ESTAGIOS)[number];
export type Encaixe = (typeof ENCAIXES)[number];

export const NOME_MAX = 20;

/** a frase do criador e do perfil: o que faz o bicho crescer (onda 4) */
export const COPY_CRESCE = "Seu bicho cresce com o que você faz nos hackathons: presença, entrega, prêmio, mentoria. Like não conta.";

export type MascoteConfig = {
  v: 1;
  especie: Especie;
  corPrincipal: CorId;
  corDetalhe: CorId;
  olhos: Olhos;
  boca: Boca;
  topo: Topo;
  roupa: Roupa;
  mao: Mao;
  acessorio: Acessorio;
  pose: Pose;
  cenario: Cenario;
  nome: string;
};

/** campos que o criador troca (tudo menos v e nome) */
export type CampoEscolha = Exclude<keyof MascoteConfig, "v" | "nome">;

// ---------- geometria (motor em lib/mascote/voxel.ts) ----------

export type Vec3 = [number, number, number];
/** x, y, z e a cor final (#rrggbb) */
export type Voxel = [number, number, number, string];

/**
 * Cor de uma primitiva: um papel (resolvido pelas cores do config) ou um
 * #rrggbb fixo. 'olho' numa pintura vira tinta ou papel conforme o fundo.
 */
export type Papel = "corpo" | "detalhe" | "escuro" | "claro" | "detalhe-escuro" | "olho" | "peca";
export type CorRef = Papel | `#${string}`;

/**
 * Primitivas em coordenadas de célula. Caixa é inclusiva nas duas pontas;
 * esfera, elipsoide e cilindro usam o centro de cada célula (i + 0.5).
 * `apagar` cava em vez de somar. `pintura` não cria volume: lança um raio
 * pra dentro (contra a normal) a partir de cada letra da matriz e pinta a
 * primeira célula ocupada que encontrar.
 */
export type Primitiva =
  | { tipo: "caixa"; de: Vec3; ate: Vec3; cor?: CorRef; apagar?: boolean }
  | { tipo: "esfera"; centro: Vec3; raio: number; cor?: CorRef; apagar?: boolean }
  | { tipo: "elipsoide"; centro: Vec3; raios: Vec3; cor?: CorRef; apagar?: boolean }
  | {
      tipo: "cilindro";
      /** centro da base */
      centro: Vec3;
      raio: number;
      altura: number;
      eixo: "x" | "y" | "z";
      cor?: CorRef;
      apagar?: boolean;
    }
  | { tipo: "pontos"; pontos: Vec3[]; cor?: CorRef; apagar?: boolean }
  | {
      tipo: "pintura";
      /** linhas de cima pra baixo; '.' ou ' ' = nada */
      matriz: string[];
      cores: Record<string, CorRef>;
      /** coluna e linha da matriz que caem na origem (padrão: meio da 1ª linha) */
      ancora?: [number, number];
      /** deslocamento da origem, no referencial da peça */
      em?: Vec3;
    };

/**
 * Peça avulsa presa num encaixe: chapéu, roupa, item na mão, óculos e,
 * na onda 4, os itens por fato verificado e a bandeira do time.
 *
 * Referencial: origem na célula vazia logo fora da superfície do encaixe.
 * A peça é desenhada com a normal canônica do encaixe (topo +y, olhos +z,
 * peito +z, costas -z, mao +x) e o motor gira se a espécie usar outra.
 */
export type Peca = { id: string; encaixe: Encaixe; primitivas: Primitiva[]; cor: CorRef };

export type Parte = {
  nome: string;
  pai: string | null;
  /** ponto de giro, em coordenadas do mundo (o viewer anima em volta dele) */
  pivo: Vec3;
  voxels: Voxel[];
};

export type EncaixePos = { pos: Vec3; normal: Vec3 };

export type Modelo = {
  /** em ordem de desenho: a parte de depois cobre a de antes na mesma célula */
  partes: Parte[];
  encaixes: Record<Encaixe, EncaixePos>;
  /** voxels de peça que caíram fora da grade 16x16x16 e foram descartados */
  fora: number;
};

export type MontarOpts = {
  itens?: Peca[];
  estagio?: Estagio;
  extras?: Peca[];
};

// ---------- espécie como dado (lib/mascote/especies/*.ts) ----------

export type ParteDef = {
  nome: string;
  pai?: string;
  pivo: Vec3;
  /** como a parte encolhe no filhote/jovem: corpo 70%/85%, cabeça 90%/95% */
  escala?: "corpo" | "cabeca";
  primitivas: Primitiva[];
};

export type EspecieDef = {
  id: Especie;
  nome: string;
  /** uma linha sobre o jeito do bicho */
  frase: string;
  /** cor principal e de detalhe que a semente prefere */
  cores: [CorId, CorId];
  partes: ParteDef[];
  /** pos = célula vazia logo fora da superfície; parte = onde a peça pendura */
  encaixes: Record<Encaixe, EncaixePos & { parte: string }>;
  /** onde a boca fica em relação ao olhos.pos (padrão [0, -3, 0]) */
  boca?: Vec3;
};

/** partes com nome fixo que o viewer anima */
export const PARTE = {
  raiz: "corpo",
  braco: "braco-d",
  olhos: "olhos",
  cenario: "cenario",
} as const;

export const GRADE = 16;
