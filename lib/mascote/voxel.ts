import { ESPECIE_DEFS } from "@/lib/mascote/especies";
import { pecaAcessorio, pecaBoca, pecaMao, pecaOlhos, pecaRoupa, pecaTopo, voxelsCenario } from "@/lib/mascote/acessorios";
import { clarear, corDoOlho, corHex, sombrear } from "@/lib/mascote/paleta";
import {
  GRADE,
  PARTE,
  type CorRef,
  type Encaixe,
  type EncaixePos,
  type EspecieDef,
  type Estagio,
  type MascoteConfig,
  type Modelo,
  type MontarOpts,
  type Parte,
  type Peca,
  type Primitiva,
  type Vec3,
  type Voxel,
} from "@/lib/mascote/tipos";

// Motor voxel do bicho (migration 043). TS puro: roda no server (SVG da
// rota) e no client (viewer 3D). A espécie é dado (lib/mascote/especies) e o
// motor só interpreta primitivas; nada aqui sabe o que é um patinho.
//
// CONTRATO usado pelas ondas 4 e 5 sem editar este arquivo:
//   montar(config, { itens?, estagio?, extras? })
// itens e extras são Peca presas num encaixe (topo, olhos, peito, costas,
// mao). Sem opts o bicho é 'adulto' sem itens.

type Mapa = Map<number, string>;

const OFF = 64;
const k = (x: number, y: number, z: number) => ((x + OFF) * 256 + (y + OFF)) * 256 + (z + OFF);
const unk = (n: number): Vec3 => [Math.floor(n / 65536) - OFF, (Math.floor(n / 256) % 256) - OFF, (n % 256) - OFF];

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const neg = (a: Vec3): Vec3 => [-a[0], -a[1], -a[2]];
const eq = (a: Vec3, b: Vec3) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export function dentroDaGrade([x, y, z]: Vec3): boolean {
  return x >= 0 && y >= 0 && z >= 0 && x < GRADE && y < GRADE && z < GRADE;
}

// ---------- referencial das peças ----------

export const NORMAL_CANONICA: Record<Encaixe, Vec3> = {
  topo: [0, 1, 0],
  olhos: [0, 0, 1],
  peito: [0, 0, 1],
  costas: [0, 0, -1],
  mao: [1, 0, 0],
};

/** direita e cima de quem olha a superfície de frente, por normal */
function base(n: Vec3): { dir: Vec3; cima: Vec3 } {
  if (n[1] === 1) return { dir: [1, 0, 0], cima: [0, 0, -1] };
  if (n[1] === -1) return { dir: [1, 0, 0], cima: [0, 0, 1] };
  const cima: Vec3 = [0, 1, 0];
  return { dir: cross(cima, n), cima };
}

type Mat = [Vec3, Vec3, Vec3]; // linhas
const I: Mat = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];
const aplicar = (m: Mat, v: Vec3): Vec3 => [dot(m[0], v), dot(m[1], v), dot(m[2], v)];

/** giro de 90°/180° que leva a normal canônica até a normal do encaixe */
export function rotacao(de: Vec3, para: Vec3): Mat {
  if (eq(de, para)) return I;
  if (eq(de, neg(para))) {
    // meia volta em torno de y (ou de x quando a normal é vertical)
    return de[1] !== 0
      ? [
          [1, 0, 0],
          [0, -1, 0],
          [0, 0, -1],
        ]
      : [
          [-1, 0, 0],
          [0, 1, 0],
          [0, 0, -1],
        ];
  }
  // Rodrigues com cos = 0, sen = 1: R v = a (a·v) + a × v
  const a = cross(de, para);
  const col = (v: Vec3): Vec3 => add(mul(a, dot(a, v)), cross(a, v));
  const c0 = col([1, 0, 0]);
  const c1 = col([0, 1, 0]);
  const c2 = col([0, 0, 1]);
  return [
    [c0[0], c1[0], c2[0]],
    [c0[1], c1[1], c2[1]],
    [c0[2], c1[2], c2[2]],
  ];
}

// ---------- cores ----------

export type Cores = { corpo: string; detalhe: string; peca?: string };

function resolverCor(ref: CorRef | undefined, cores: Cores, fundo?: string): string {
  const r = ref ?? "corpo";
  if (r.startsWith("#")) return r.toLowerCase();
  switch (r) {
    case "corpo":
      return cores.corpo;
    case "detalhe":
      return cores.detalhe;
    case "escuro":
      return sombrear(cores.corpo, 0.72);
    case "claro":
      return clarear(cores.corpo, 0.45);
    case "detalhe-escuro":
      return sombrear(cores.detalhe, 0.72);
    case "olho":
      return corDoOlho(fundo ?? cores.corpo);
    case "peca":
      return cores.peca ?? cores.detalhe;
    default:
      return cores.corpo;
  }
}

// ---------- primitivas ----------

/** células (offset inteiro em relação à origem) de uma primitiva sólida */
function celulas(p: Exclude<Primitiva, { tipo: "pintura" }>): Vec3[] {
  const out: Vec3[] = [];
  const caixa = (lo: Vec3, hi: Vec3, dentro: (c: Vec3) => boolean) => {
    for (let x = Math.floor(lo[0]); x <= Math.ceil(hi[0]); x++)
      for (let y = Math.floor(lo[1]); y <= Math.ceil(hi[1]); y++)
        for (let z = Math.floor(lo[2]); z <= Math.ceil(hi[2]); z++) if (dentro([x + 0.5, y + 0.5, z + 0.5])) out.push([x, y, z]);
  };
  switch (p.tipo) {
    case "pontos":
      return p.pontos.map((q) => [...q] as Vec3);
    case "caixa": {
      const lo: Vec3 = [Math.min(p.de[0], p.ate[0]), Math.min(p.de[1], p.ate[1]), Math.min(p.de[2], p.ate[2])];
      const hi: Vec3 = [Math.max(p.de[0], p.ate[0]), Math.max(p.de[1], p.ate[1]), Math.max(p.de[2], p.ate[2])];
      for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) out.push([x, y, z]);
      return out;
    }
    case "esfera": {
      const r = p.raio;
      caixa(sub(p.centro, [r + 1, r + 1, r + 1]), add(p.centro, [r, r, r]), (c) => {
        const d = sub(c, p.centro);
        return dot(d, d) <= r * r;
      });
      return out;
    }
    case "elipsoide": {
      const [a, b, cc] = p.raios;
      caixa(sub(p.centro, [a + 1, b + 1, cc + 1]), add(p.centro, [a, b, cc]), (c) => {
        const d = sub(c, p.centro);
        return (d[0] / a) ** 2 + (d[1] / b) ** 2 + (d[2] / cc) ** 2 <= 1;
      });
      return out;
    }
    case "cilindro": {
      const ax = p.eixo === "x" ? 0 : p.eixo === "y" ? 1 : 2;
      const r = p.raio;
      const lo = sub(p.centro, [r + 1, r + 1, r + 1]);
      const hi = add(p.centro, [r, r, r]);
      lo[ax] = p.centro[ax];
      hi[ax] = p.centro[ax] + p.altura - 1;
      caixa(lo, hi, (c) => {
        const along = c[ax] - p.centro[ax];
        if (along < 0 || along > p.altura) return false;
        let s = 0;
        for (let i = 0; i < 3; i++) if (i !== ax) s += (c[i] - p.centro[i]) ** 2;
        return s <= r * r;
      });
      return out;
    }
  }
}

type Quadro = { rot: Mat; origem: Vec3; normal: Vec3 /* canônica, no referencial da peça */ };
const QUADRO_MUNDO: Quadro = { rot: I, origem: [0, 0, 0], normal: [0, 0, 1] };

const paraMundo = (q: Quadro, local: Vec3): Vec3 => add(q.origem, aplicar(q.rot, local));

/**
 * Pinta a matriz ASCII na superfície: cada letra lança um raio contra a
 * normal a partir de 2 células fora do plano e colore a primeira célula
 * ocupada. Devolve só os voxels pintados (a superfície não muda de forma).
 */
export function pintarRosto(
  ocupacao: Mapa,
  matriz: string[],
  plano: EncaixePos,
  cores: Record<string, CorRef>,
  paleta: Cores,
  opts: { ancora?: [number, number]; em?: Vec3; rot?: Mat; normalLocal?: Vec3 } = {},
): Voxel[] {
  const nLocal = opts.normalLocal ?? plano.normal;
  const rot = opts.rot ?? I;
  const { dir, cima } = base(nLocal);
  const larg = Math.max(...matriz.map((l) => l.length));
  const [ac, al] = opts.ancora ?? [Math.floor(larg / 2), 0];
  const em = opts.em ?? [0, 0, 0];
  const passo = neg(aplicar(rot, nLocal));
  const out: Voxel[] = [];
  matriz.forEach((linha, r) => {
    [...linha].forEach((ch, c) => {
      const ref = cores[ch];
      if (!ref) return;
      const local = add(add(em, mul(dir, c - ac)), mul(cima, al - r));
      let p = add(plano.pos, aplicar(rot, add(local, mul(nLocal, 2))));
      for (let i = 0; i < 10; i++) {
        const hit = ocupacao.get(k(p[0], p[1], p[2]));
        if (hit) {
          out.push([p[0], p[1], p[2], resolverCor(ref, paleta, hit)]);
          return;
        }
        p = add(p, passo);
      }
    });
  });
  return out;
}

function voxelizar(prims: Primitiva[], q: Quadro, cores: Cores, ocupacao: Mapa, padrao: CorRef = "corpo"): Mapa {
  const m: Mapa = new Map();
  for (const p of prims) {
    if (p.tipo === "pintura") {
      // pinta sobre o que já existe (corpo e peças anteriores) e sobre a própria peça
      const occ = new Map([...ocupacao, ...m]);
      const vs = pintarRosto(occ, p.matriz, { pos: q.origem, normal: q.normal }, p.cores, cores, {
        ancora: p.ancora,
        em: p.em,
        rot: q.rot,
        normalLocal: q.normal,
      });
      for (const [x, y, z, c] of vs) m.set(k(x, y, z), c);
      continue;
    }
    const cor = resolverCor(p.cor ?? padrao, cores);
    for (const c of celulas(p)) {
      const w = paraMundo(q, c);
      if (p.apagar) m.delete(k(w[0], w[1], w[2]));
      else m.set(k(w[0], w[1], w[2]), cor);
    }
  }
  return m;
}

const paraVoxels = (m: Mapa): Voxel[] => [...m].map(([n, c]) => [...unk(n), c] as Voxel);

// ---------- estágio ----------

const ESCALA: Record<Estagio, { corpo: number; cabeca: number }> = {
  filhote: { corpo: 0.7, cabeca: 0.9 },
  jovem: { corpo: 0.85, cabeca: 0.95 },
  adulto: { corpo: 1, cabeca: 1 },
};

type Transf = { pivo: Vec3; ancora: Vec3; s: number }; // T(p) = ancora + (p - pivo) * s
const T = (t: Transf, p: Vec3): Vec3 => add(t.ancora, mul(sub(p, t.pivo), t.s));

const arred = (v: Vec3): Vec3 => v.map((n) => Math.round(n)) as Vec3;

/**
 * Encolhe a primitiva em vez dos voxels: caixa continua caixa e esfera
 * continua esfera, sem o serrilhado de reamostrar 70%.
 */
function escalar(p: Primitiva, t: Transf): Primitiva {
  if (t.s === 1 && eq(t.pivo, t.ancora)) return p;
  switch (p.tipo) {
    case "caixa": {
      const lo: Vec3 = [Math.min(p.de[0], p.ate[0]), Math.min(p.de[1], p.ate[1]), Math.min(p.de[2], p.ate[2])];
      const hi: Vec3 = [Math.max(p.de[0], p.ate[0]) + 1, Math.max(p.de[1], p.ate[1]) + 1, Math.max(p.de[2], p.ate[2]) + 1];
      const a = arred(T(t, lo));
      const b = arred(T(t, hi));
      const ate = b.map((n, i) => Math.max(a[i], n - 1)) as Vec3;
      return { ...p, de: a, ate };
    }
    case "esfera":
      return { ...p, centro: T(t, p.centro), raio: p.raio * t.s };
    case "elipsoide":
      return { ...p, centro: T(t, p.centro), raios: mul(p.raios, t.s) };
    case "cilindro": {
      const ax = p.eixo === "x" ? 0 : p.eixo === "y" ? 1 : 2;
      const centro = T(t, p.centro);
      const ini = Math.round(centro[ax]);
      const fim = Math.round(T(t, add(p.centro, ax === 0 ? [p.altura, 0, 0] : ax === 1 ? [0, p.altura, 0] : [0, 0, p.altura]))[ax]);
      centro[ax] = ini;
      return { ...p, centro, raio: p.raio * t.s, altura: Math.max(1, fim - ini) };
    }
    case "pontos":
      return { ...p, pontos: p.pontos.map((q) => T(t, add(q, [0.5, 0.5, 0.5])).map(Math.floor) as Vec3) };
    case "pintura":
      return p;
  }
}

/** encosta o encaixe na superfície: sai se estiver dentro, chega perto se estiver solto */
function encostar(pos: Vec3, n: Vec3, occ: Mapa): Vec3 {
  let p = pos;
  const tem = (q: Vec3) => occ.has(k(q[0], q[1], q[2]));
  for (let i = 0; i < 6 && tem(p); i++) p = add(p, n);
  for (let i = 0; i < 3; i++) {
    const atras = sub(p, n);
    if (tem(atras)) break;
    p = atras;
  }
  return tem(sub(p, n)) ? p : pos;
}

// ---------- montar ----------

export type MontarInterno = { modelo: Modelo; cores: Cores };

function coresDe(config: MascoteConfig): Cores {
  return { corpo: corHex(config.corPrincipal), detalhe: corHex(config.corDetalhe) };
}

/** peças que o config escolhe, na ordem em que entram (roupa e rosto antes do chapéu) */
export function pecasDoConfig(config: MascoteConfig, esp: EspecieDef): Peca[] {
  const out: Peca[] = [pecaOlhos(config.olhos), pecaBoca(config.boca, esp.boca ?? [0, -3, 0])];
  for (const p of [pecaRoupa(config.roupa), pecaAcessorio(config.acessorio), pecaTopo(config.topo), pecaMao(config.mao)]) if (p) out.push(p);
  return out;
}

export function montar(config: MascoteConfig, opts?: MontarOpts): Modelo {
  const estagio = opts?.estagio ?? "adulto";
  const esp = ESPECIE_DEFS[config.especie] ?? ESPECIE_DEFS.cracha;
  const cores = coresDe(config);

  // 1. partes da espécie, encolhidas pelo estágio (filho segue o pai)
  const transf = new Map<string, Transf>();
  const partes: Parte[] = [];
  const ocupacao: Mapa = new Map();
  for (const def of esp.partes) {
    const paiT = def.pai ? transf.get(def.pai) : undefined;
    const s = def.escala ? ESCALA[estagio][def.escala] : 1;
    const ancora = paiT ? T(paiT, def.pivo) : def.pivo;
    const t: Transf = { pivo: def.pivo, ancora, s };
    transf.set(def.nome, t);
    const m = voxelizar(
      def.primitivas.map((p) => escalar(p, t)),
      QUADRO_MUNDO,
      cores,
      new Map(),
    );
    for (const [n, c] of m) ocupacao.set(n, c);
    partes.push({ nome: def.nome, pai: def.pai ?? null, pivo: ancora, voxels: paraVoxels(m) });
  }

  // 2. encaixes acompanham a parte e encostam na superfície encolhida
  const encaixes = {} as Record<Encaixe, EncaixePos>;
  const donos = {} as Record<Encaixe, string>;
  for (const [nome, e] of Object.entries(esp.encaixes) as [Encaixe, EspecieDef["encaixes"][Encaixe]][]) {
    const t = transf.get(e.parte) ?? transf.get(PARTE.raiz)!;
    const centro = T(t, add(e.pos, [0.5, 0.5, 0.5]));
    const pos = centro.map(Math.floor) as Vec3;
    encaixes[nome] = { pos: encostar(pos, e.normal, ocupacao), normal: [...e.normal] };
    donos[nome] = e.parte;
  }

  // 3. rosto, roupa, acessório, chapéu, mão; depois itens e extras
  let fora = 0;
  const usados = new Set(partes.map((p) => p.nome));
  const pecas = [...pecasDoConfig(config, esp), ...(opts?.itens ?? []), ...(opts?.extras ?? [])];
  for (const peca of pecas) {
    const enc = encaixes[peca.encaixe];
    if (!enc) continue;
    const canon = NORMAL_CANONICA[peca.encaixe];
    const q: Quadro = { rot: rotacao(canon, enc.normal), origem: enc.pos, normal: canon };
    const m = voxelizar(peca.primitivas, q, { ...cores, peca: resolverCor(peca.cor, cores) }, ocupacao, "peca");
    const voxels: Voxel[] = [];
    for (const v of paraVoxels(m)) {
      if (!dentroDaGrade([v[0], v[1], v[2]])) {
        fora++;
        continue;
      }
      voxels.push(v);
      ocupacao.set(k(v[0], v[1], v[2]), v[3]);
    }
    let nome = peca.id;
    for (let i = 2; usados.has(nome); i++) nome = `${peca.id}-${i}`;
    usados.add(nome);
    partes.push({ nome, pai: donos[peca.encaixe], pivo: [...enc.pos], voxels });
  }

  // 4. cenário fica fora da grade, atrás de tudo
  const cen = voxelsCenario(config.cenario);
  if (cen.length) partes.unshift({ nome: PARTE.cenario, pai: null, pivo: [0, 0, 0], voxels: cen });

  return { partes, encaixes, fora };
}

/** todas as células do modelo; a parte de depois cobre a de antes */
export function achatar(modelo: Modelo): Map<string, { pos: Vec3; cor: string; parte: string }> {
  const out = new Map<string, { pos: Vec3; cor: string; parte: string }>();
  for (const p of modelo.partes)
    for (const [x, y, z, cor] of p.voxels) out.set(`${x},${y},${z}`, { pos: [x, y, z], cor, parte: p.nome });
  return out;
}
