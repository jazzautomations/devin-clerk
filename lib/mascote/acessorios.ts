import type {
  Acessorio,
  Boca,
  Cenario,
  CorRef,
  Mao,
  Olhos,
  Peca,
  Primitiva,
  Roupa,
  Topo,
  Vec3,
  Voxel,
} from "@/lib/mascote/tipos";

// Peças do criador (migration 043). Cada uma é Peca: primitivas no
// referencial do encaixe (origem na célula logo fora da superfície, normal
// canônica: topo +y, olhos +z, peito +z, costas -z, mao +x). O motor gira
// e posiciona; nenhuma peça sabe em que espécie está.
//
// Limites pra caber na grade 16 em todas as espécies (o teste cobre):
// topo até 3 acima da origem; mao até 1 pra fora (+x).

const TINTA: CorRef = "#1d1d1f";
const OURO: CorRef = "#e8b923";

// ---------- rosto (pintura) ----------

const ROSTO_CORES: Record<string, CorRef> = { "#": "olho", w: "#fefefe", r: "#ef5a7a" };

const MATRIZ_OLHOS: Record<Olhos, string[]> = {
  ponto: [".#...#.", ".#...#."],
  feliz: [".#...#.", "#.#.#.#"],
  sono: [".......", "##...##"],
  brilho: ["w#...w#", "##...##"],
  piscadinha: [".#.....", ".#...##"],
  surpreso: ["##...##", "##...##"],
};

const MATRIZ_BOCA: Record<Boca, string[]> = {
  sorriso: ["#...#", ".###."],
  risada: ["#####", ".#r#."],
  reta: [".###."],
  lingua: [".###.", "..r.."],
  gato: ["#.#.#", ".#.#."],
};

export function pecaOlhos(olhos: Olhos): Peca {
  return {
    id: "olhos",
    encaixe: "olhos",
    cor: "olho",
    primitivas: [{ tipo: "pintura", matriz: MATRIZ_OLHOS[olhos] ?? MATRIZ_OLHOS.ponto, cores: ROSTO_CORES }],
  };
}

export function pecaBoca(boca: Boca, em: Vec3): Peca {
  return {
    id: "boca",
    encaixe: "olhos",
    cor: "olho",
    primitivas: [{ tipo: "pintura", matriz: MATRIZ_BOCA[boca] ?? MATRIZ_BOCA.sorriso, cores: ROSTO_CORES, em }],
  };
}

// ---------- chapéu (topo, normal +y) ----------

const TOPO: Record<Exclude<Topo, "nada">, Primitiva[]> = {
  bone: [
    { tipo: "caixa", de: [-3, 0, -3], ate: [3, 0, 2] },
    { tipo: "caixa", de: [-2, 1, -2], ate: [2, 1, 1] },
    { tipo: "caixa", de: [-3, 0, 3], ate: [3, 0, 5], cor: "detalhe-escuro" },
    { tipo: "pontos", pontos: [[0, 2, 0]], cor: "claro" },
  ],
  gorro: [
    { tipo: "caixa", de: [-4, 0, -3], ate: [4, 0, 3], cor: "detalhe-escuro" },
    { tipo: "caixa", de: [-3, 1, -3], ate: [3, 1, 3] },
    { tipo: "caixa", de: [-2, 2, -2], ate: [2, 2, 2] },
    { tipo: "pontos", pontos: [[0, 3, 0]], cor: "#fefefe" },
  ],
  cartola: [
    { tipo: "caixa", de: [-4, 0, -3], ate: [4, 0, 3], cor: TINTA },
    { tipo: "caixa", de: [-2, 1, -2], ate: [2, 3, 2], cor: TINTA },
    { tipo: "caixa", de: [-2, 1, -2], ate: [2, 1, 2], cor: "peca" },
  ],
  coroa: [
    { tipo: "caixa", de: [-3, 0, -3], ate: [3, 0, 3], cor: OURO },
    { tipo: "caixa", de: [-2, 0, -2], ate: [2, 0, 2], apagar: true },
    {
      tipo: "pontos",
      pontos: [
        [-3, 1, -3],
        [3, 1, -3],
        [-3, 1, 3],
        [3, 1, 3],
        [0, 1, 3],
        [0, 1, -3],
        [-3, 1, 0],
        [3, 1, 0],
        [0, 2, 3],
        [-3, 2, -3],
        [3, 2, 3],
      ],
      cor: OURO,
    },
    {
      tipo: "pontos",
      pontos: [
        [0, 0, 3],
        [-3, 0, 0],
        [3, 0, 0],
      ],
      cor: "peca",
    },
  ],
  helice: [
    { tipo: "caixa", de: [-3, 0, -3], ate: [3, 0, 3] },
    { tipo: "caixa", de: [-2, 1, -2], ate: [2, 1, 2] },
    { tipo: "caixa", de: [-3, 0, 0], ate: [3, 1, 0], cor: "#ffd23f" },
    { tipo: "pontos", pontos: [[0, 2, 0]], cor: TINTA },
    { tipo: "caixa", de: [-3, 3, 0], ate: [3, 3, 0], cor: "#ef4b4b" },
    { tipo: "caixa", de: [0, 3, -3], ate: [0, 3, 3], cor: "#3f8cff" },
  ],
  capacete: [
    { tipo: "caixa", de: [-4, 0, -4], ate: [4, 0, 6] },
    { tipo: "caixa", de: [-3, 1, -3], ate: [3, 1, 3] },
    { tipo: "caixa", de: [-2, 2, -2], ate: [2, 2, 2] },
    { tipo: "caixa", de: [0, 1, -4], ate: [0, 3, 3], cor: "claro" },
  ],
  laco: [
    { tipo: "caixa", de: [-3, 0, 0], ate: [-1, 2, 0] },
    { tipo: "caixa", de: [1, 0, 0], ate: [3, 2, 0] },
    { tipo: "caixa", de: [-2, 1, 0], ate: [-2, 1, 0], apagar: true },
    { tipo: "caixa", de: [2, 1, 0], ate: [2, 1, 0], apagar: true },
    { tipo: "pontos", pontos: [[0, 1, 0]], cor: "detalhe-escuro" },
  ],
};

export function pecaTopo(topo: Topo): Peca | null {
  if (topo === "nada" || !TOPO[topo]) return null;
  return { id: `topo-${topo}`, encaixe: "topo", cor: "detalhe", primitivas: TOPO[topo] };
}

// ---------- roupa no peito (normal +z) ----------

const ROUPA: Record<Exclude<Roupa, "nada">, Primitiva[]> = {
  gravata: [{ tipo: "pintura", matriz: [".#.", ".#.", "###", ".#."], cores: { "#": "peca" } }],
  borboleta: [
    { tipo: "caixa", de: [-2, -1, -1], ate: [-1, 1, 0] },
    { tipo: "caixa", de: [1, -1, -1], ate: [2, 1, 0] },
    { tipo: "pontos", pontos: [[0, 0, 0]], cor: "detalhe-escuro" },
  ],
  bandana: [{ tipo: "pintura", matriz: ["#####", ".#w#.", "..#.."], cores: { "#": "peca", w: "#fefefe" } }],
  suspensorio: [{ tipo: "pintura", matriz: ["#...#", "#...#", "o...o", "#...#"], cores: { "#": "peca", o: OURO } }],
  logo: [{ tipo: "pintura", matriz: [".#.#.", "#...#", ".#.#."], cores: { "#": "peca" } }],
};

export function pecaRoupa(roupa: Roupa): Peca | null {
  if (roupa === "nada" || !ROUPA[roupa]) return null;
  return { id: `roupa-${roupa}`, encaixe: "peito", cor: "detalhe", primitivas: ROUPA[roupa] };
}

// ---------- item na mão (normal +x) ----------

const MAO: Record<Exclude<Mao, "nada">, Primitiva[]> = {
  caneca: [
    { tipo: "caixa", de: [0, -1, -1], ate: [1, 1, 0], cor: "#fefefe" },
    { tipo: "caixa", de: [0, 1, -1], ate: [1, 1, 0], cor: "#5a3420" },
    { tipo: "caixa", de: [0, 0, -1], ate: [1, 0, 0], cor: "peca" },
  ],
  notebook: [
    { tipo: "caixa", de: [0, -1, -2], ate: [0, 2, 1], cor: "#3a3c40" },
    { tipo: "caixa", de: [1, 0, -1], ate: [1, 1, 0], cor: "#8fd6ff" },
  ],
  lapis: [
    { tipo: "caixa", de: [0, 0, 0], ate: [0, 2, 0], cor: "#ffd23f" },
    { tipo: "pontos", pontos: [[0, 3, 0]], cor: "#f2c79a" },
    { tipo: "pontos", pontos: [[0, 4, 0]], cor: TINTA },
    { tipo: "pontos", pontos: [[0, -1, 0]], cor: "#ff8fb1" },
  ],
  chave: [
    { tipo: "caixa", de: [0, -1, 0], ate: [0, 2, 0], cor: "#a3a8ae" },
    { tipo: "caixa", de: [0, 3, -1], ate: [0, 4, 1], cor: "#a3a8ae" },
    { tipo: "pontos", pontos: [[0, 4, 0]], apagar: true },
    { tipo: "pontos", pontos: [[0, -1, 0]], cor: "peca" },
  ],
  balao: [
    { tipo: "caixa", de: [0, 0, 0], ate: [0, 3, 0], cor: "#555555" },
    { tipo: "esfera", centro: [0.5, 5.5, 0.5], raio: 1.8, cor: "peca" },
  ],
};

export function pecaMao(mao: Mao): Peca | null {
  if (mao === "nada" || !MAO[mao]) return null;
  return { id: `mao-${mao}`, encaixe: "mao", cor: "detalhe", primitivas: MAO[mao] };
}

// ---------- acessório de rosto (normal +z, origem no meio dos olhos) ----------

const ROSTO: Record<Exclude<Acessorio, "nada">, Primitiva[]> = {
  // óculos são pintados em volta dos olhos (a linha 1 da matriz é a dos olhos)
  oculos: [{ tipo: "pintura", matriz: ["###.###", "#.###.#", "#.#.#.#", "###.###"], cores: { "#": TINTA }, ancora: [3, 1] }],
  "oculos-escuros": [
    { tipo: "pintura", matriz: ["g###g##", "###.###"], cores: { "#": TINTA, g: "#7d828a" }, ancora: [3, 0] },
  ],
  monoculo: [
    {
      tipo: "pintura",
      matriz: ["....ooo", "....o.o", "....o.o", "....ooo", "......o", ".....o."],
      cores: { o: OURO },
      ancora: [3, 1],
    },
  ],
  fone: [
    { tipo: "caixa", de: [-5, -2, -3], ate: [-5, 0, -1], cor: "peca" },
    { tipo: "caixa", de: [5, -2, -3], ate: [5, 0, -1], cor: "peca" },
    { tipo: "caixa", de: [-5, 1, -2], ate: [-5, 3, -2], cor: TINTA },
    { tipo: "caixa", de: [5, 1, -2], ate: [5, 3, -2], cor: TINTA },
    { tipo: "caixa", de: [-4, 4, -2], ate: [4, 4, -2], cor: TINTA },
  ],
};

export function pecaAcessorio(a: Acessorio): Peca | null {
  if (a === "nada" || !ROSTO[a]) return null;
  return { id: `rosto-${a}`, encaixe: "olhos", cor: "detalhe", primitivas: ROSTO[a] };
}

// ---------- cenário (fora da grade, cores fixas) ----------

function chao(cor1: string, cor2: string, y = -1, de = -1, ate = 16): Voxel[] {
  const out: Voxel[] = [];
  for (let x = de; x <= ate; x++) for (let z = de; z <= ate; z++) out.push([x, y, z, (x + z) % 2 === 0 ? cor1 : cor2]);
  return out;
}

function bloco(de: Vec3, ate: Vec3, cor: string): Voxel[] {
  const out: Voxel[] = [];
  for (let x = de[0]; x <= ate[0]; x++) for (let y = de[1]; y <= ate[1]; y++) for (let z = de[2]; z <= ate[2]; z++) out.push([x, y, z, cor]);
  return out;
}

const CENARIO: Record<Exclude<Cenario, "nada">, () => Voxel[]> = {
  "mesa-de-hackathon": () => [
    ...chao("#d8b48a", "#cfa97c"),
    // mesa atrás, com notebook, caneca e caixa de pizza
    ...bloco([-1, 0, -1], [16, 3, -1], "#8a5a3b"),
    ...bloco([-1, 4, -1], [16, 4, 0], "#b07a4f"),
    ...bloco([1, 5, -1], [5, 5, 0], "#3a3c40"),
    ...bloco([1, 6, -1], [5, 9, -1], "#3a3c40"),
    ...bloco([2, 7, -1], [4, 8, -1], "#8fd6ff"),
    ...bloco([11, 5, -1], [15, 5, 0], "#f2e2c4"),
    ...bloco([8, 5, -1], [8, 6, -1], "#fefefe"),
  ],
  palco: () => {
    const out: Voxel[] = [...chao("#2a2b30", "#33353b"), ...bloco([-1, -2, -1], [16, -2, 16], "#1b1c20")];
    // luzes na beirada da frente
    for (let i = -1; i <= 16; i += 3) out.push([i, -1, 16, "#ffd23f"], [16, -1, i, "#ffd23f"]);
    // pedestal do microfone
    out.push(...bloco([0, 0, 14], [0, 7, 14], "#5a5d63"), ...bloco([0, 8, 14], [0, 9, 14], "#1d1d1f"));
    return out;
  },
  "servidor-rack": () => {
    const out: Voxel[] = [...chao("#c9ccd1", "#bfc3c9")];
    out.push(...bloco([-1, 0, -1], [3, 12, 0], "#2b2d33"));
    for (let y = 1; y <= 11; y += 2) out.push([0, y, 1, y % 4 === 1 ? "#3ecf8e" : "#ffd23f"], [2, y, 1, "#3ecf8e"]);
    return out;
  },
};

export function voxelsCenario(c: Cenario): Voxel[] {
  return c === "nada" || !CENARIO[c] ? [] : CENARIO[c]();
}

// ---------- rótulos do criador ----------

export const ROTULOS = {
  especie: { cracha: "crachá", teclado: "teclado", pizza: "pizza", servidor: "servidor", patinho: "patinho", mouse: "mouse", cafe: "café", foguete: "foguete" },
  olhos: { ponto: "ponto", feliz: "feliz", sono: "sono", brilho: "brilho", piscadinha: "piscadinha", surpreso: "surpreso" },
  boca: { sorriso: "sorriso", risada: "risada", reta: "reta", lingua: "língua", gato: "de gato" },
  topo: { nada: "nada", bone: "boné", gorro: "gorro", cartola: "cartola", coroa: "coroa", helice: "hélice", capacete: "capacete", laco: "laço" },
  roupa: { nada: "nada", gravata: "gravata", borboleta: "gravata-borboleta", bandana: "bandana", suspensorio: "suspensório", logo: "logo no peito" },
  mao: { nada: "nada", caneca: "caneca", notebook: "notebook", lapis: "lápis", chave: "chave inglesa", balao: "balão" },
  acessorio: { nada: "nada", oculos: "óculos", "oculos-escuros": "óculos escuros", monoculo: "monóculo", fone: "fone" },
  pose: { pula: "pula", acena: "acena", danca: "dança" },
  cenario: { nada: "nada", "mesa-de-hackathon": "mesa de hackathon", palco: "palco", "servidor-rack": "rack de servidor" },
} as const;
