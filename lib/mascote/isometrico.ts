import { sombrear } from "@/lib/mascote/paleta";
import { montar } from "@/lib/mascote/voxel";
import type { MascoteConfig, Modelo, MontarOpts } from "@/lib/mascote/tipos";

// SVG isométrico do bicho (migration 043): lista, OG, celular e quem não
// tem WebGL. Projeção 2:1 (a do pixel art), só a face que aparece de cada
// voxel, sombra por face (topo 100%, esquerda 82%, direita 66%).
//
// Visibilidade exata em vez de pintor solto: a tela isométrica é uma malha
// de triângulos e cada face cobre dois. Por triângulo fica a face mais
// perto do olho (maior x+y+z, a ordem do pintor). Como nada se sobrepõe
// depois disso, faces da mesma cor viram um <path> só, e faces vizinhas
// da mesma cor numa linha viram um paralelogramo.

/**
 * Suba quando a arte mudar (espécie, peça, paleta, projeção): a URL com
 * ?v=<hash> é cache imutável de 1 ano e só muda se o hash mudar.
 */
export const ARTE_VERSAO = 1;

type Pt = [number, number];
const P = (x: number, y: number, z: number): Pt => [2 * (x - z), x + z - 2 * y];

type Lado = "topo" | "esq" | "dir";
const SOMBRA: Record<Lado, number> = { topo: 1, esq: 0.82, dir: 0.66 };

type Face = { lado: Lado; x: number; y: number; z: number; cor: string; tris: [Pt[], Pt[]]; depth: number };

function faceDe(lado: Lado, x: number, y: number, z: number, cor: string): Face {
  const depth = x + y + z;
  if (lado === "topo") {
    const A = P(x, y + 1, z), B = P(x + 1, y + 1, z), C = P(x + 1, y + 1, z + 1), D = P(x, y + 1, z + 1);
    return { lado, x, y, z, cor, depth, tris: [[A, B, C], [A, C, D]] };
  }
  if (lado === "dir") {
    const P1 = P(x + 1, y, z), P2 = P(x + 1, y + 1, z), P3 = P(x + 1, y + 1, z + 1), P4 = P(x + 1, y, z + 1);
    return { lado, x, y, z, cor, depth, tris: [[P1, P2, P3], [P1, P3, P4]] };
  }
  const Q1 = P(x, y, z + 1), Q2 = P(x + 1, y, z + 1), Q3 = P(x + 1, y + 1, z + 1), Q4 = P(x, y + 1, z + 1);
  return { lado, x, y, z, cor, depth, tris: [[Q1, Q2, Q3], [Q1, Q3, Q4]] };
}

const triId = (t: Pt[]) =>
  t
    .map((p) => `${p[0]},${p[1]}`)
    .sort()
    .join("|");

function escXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** contorno de uma tira de faces vizinhas (todas inteiras) */
function tira(lado: Lado, a: Face, b: Face): Pt[] {
  if (lado === "topo") return [P(a.x, a.y + 1, a.z), P(b.x + 1, b.y + 1, b.z), P(b.x + 1, b.y + 1, b.z + 1), P(a.x, a.y + 1, a.z + 1)];
  if (lado === "esq") return [P(a.x, a.y, a.z + 1), P(b.x + 1, b.y, b.z + 1), P(b.x + 1, b.y + 1, b.z + 1), P(a.x, a.y + 1, a.z + 1)];
  // dir: tira ao longo de z
  return [P(a.x + 1, a.y, a.z), P(a.x + 1, a.y + 1, a.z), P(b.x + 1, b.y + 1, b.z + 1), P(b.x + 1, b.y, b.z + 1)];
}

function poly(pts: Pt[]): string {
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) d += `l${pts[i][0] - pts[i - 1][0]} ${pts[i][1] - pts[i - 1][1]}`;
  return `${d}z`;
}

export type SvgOpts = { tamanho?: number; titulo?: string };

export function toSvg(modelo: Modelo, opts: SvgOpts = {}): string {
  const tamanho = opts.tamanho ?? 160;
  const cel = new Map<string, string>();
  for (const p of modelo.partes) for (const [x, y, z, c] of p.voxels) cel.set(`${x},${y},${z}`, c);
  const tem = (x: number, y: number, z: number) => cel.has(`${x},${y},${z}`);

  // 1. faces expostas
  const faces: Face[] = [];
  for (const [key, cor] of cel) {
    const [x, y, z] = key.split(",").map(Number);
    if (!tem(x, y + 1, z)) faces.push(faceDe("topo", x, y, z, cor));
    if (!tem(x, y, z + 1)) faces.push(faceDe("esq", x, y, z, cor));
    if (!tem(x + 1, y, z)) faces.push(faceDe("dir", x, y, z, cor));
  }

  // 2. por triângulo, a face mais perto
  const dono = new Map<string, Face>();
  for (const f of faces)
    for (const t of f.tris) {
      const id = triId(t);
      const atual = dono.get(id);
      if (!atual || f.depth > atual.depth) dono.set(id, f);
    }

  // 3. agrupa por cor sombreada; faces inteiras em tiras, sobras em triângulos
  const porCor = new Map<string, string[]>();
  const push = (fill: string, d: string) => {
    const arr = porCor.get(fill);
    if (arr) arr.push(d);
    else porCor.set(fill, [d]);
  };
  const inteiras = new Map<string, Face[]>();
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const marca = (pts: Pt[]) => {
    for (const [px, py] of pts) {
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
  };
  for (const f of faces) {
    const vis = f.tris.map((t) => dono.get(triId(t)) === f);
    const fill = sombrear(f.cor, SOMBRA[f.lado]);
    if (vis[0] && vis[1]) {
      // linha da tira: topo e esq correm em x, dir corre em z
      const linha = f.lado === "dir" ? `${f.lado}|${fill}|${f.x}|${f.y}` : `${f.lado}|${fill}|${f.y}|${f.z}`;
      const arr = inteiras.get(linha);
      if (arr) arr.push(f);
      else inteiras.set(linha, [f]);
    } else {
      f.tris.forEach((t, i) => {
        if (!vis[i]) return;
        marca(t);
        push(fill, poly(t));
      });
    }
  }
  for (const [linha, fs] of inteiras) {
    const [lado, fill] = linha.split("|") as [Lado, string];
    const pos = (f: Face) => (lado === "dir" ? f.z : f.x);
    fs.sort((a, b) => pos(a) - pos(b));
    let ini = fs[0];
    let fim = fs[0];
    const fecha = () => {
      const pts = tira(lado, ini, fim);
      marca(pts);
      push(fill, poly(pts));
    };
    for (let i = 1; i < fs.length; i++) {
      if (pos(fs[i]) === pos(fim) + 1) fim = fs[i];
      else {
        fecha();
        ini = fim = fs[i];
      }
    }
    fecha();
  }

  if (!Number.isFinite(minX)) {
    minX = minY = 0;
    maxX = maxY = 1;
  }
  const pad = 1;
  const w = maxX - minX + 2 * pad;
  const h = maxY - minY + 2 * pad;
  const titulo = opts.titulo ? `<title>${escXml(opts.titulo)}</title>` : "";
  const paths = [...porCor]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([fill, ds]) => `<path fill="${fill}" stroke="${fill}" d="${ds.join("")}"/>`)
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX - pad} ${minY - pad} ${w} ${h}" width="${tamanho}" height="${tamanho}" role="img">` +
    `${titulo}<g stroke-width=".4" stroke-linejoin="round">${paths}</g></svg>`
  );
}

/** SVG como data URI pra <img> (miniatura do criador e fallback sem WebGL) */
export function svgDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

// ---------- hash, cache e URL ----------

/** JSON com chaves em ordem: o mesmo bicho dá o mesmo hash em qualquer processo */
function estavel(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(estavel).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${estavel(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

/** cyrb53: hash de 53 bits, curto o bastante pra URL */
function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** hash de {config, itens, estagio, extras} + versão da arte */
export function hashMascote(config: MascoteConfig, opts?: MontarOpts): string {
  const o = {
    a: ARTE_VERSAO,
    c: config,
    e: opts?.estagio ?? "adulto",
    i: opts?.itens?.length ? opts.itens : undefined,
    x: opts?.extras?.length ? opts.extras : undefined,
  };
  return cyrb53(estavel(o)).toString(36);
}

/** URL do SVG do bicho de um membro; com hash, cache imutável */
export function mascoteSrc(memberId: number, hash?: string | null): string {
  return `/api/mascote/m/${memberId}${hash ? `?v=${hash}` : ""}`;
}

const CACHE_MAX = 500;
const cache = new Map<string, string>();

/** SVG do bicho com cache em memória (limite 500, sai o mais antigo) */
export function svgDoBicho(config: MascoteConfig, opts?: MontarOpts & SvgOpts): { svg: string; hash: string } {
  const hash = hashMascote(config, opts);
  const key = `${hash}|${opts?.tamanho ?? 160}|${opts?.titulo ?? ""}`;
  const hit = cache.get(key);
  if (hit !== undefined) {
    cache.delete(key);
    cache.set(key, hit);
    return { svg: hit, hash };
  }
  const svg = toSvg(montar(config, opts), { tamanho: opts?.tamanho, titulo: opts?.titulo });
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, svg);
  return { svg, hash };
}

/** só testes */
export function tamanhoDoCache(): number {
  return cache.size;
}
