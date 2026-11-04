"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { BufferGeometry, Group, Material, Vector3 } from "three";
import { svgDataUri, toSvg } from "@/lib/mascote/isometrico";
import { montar } from "@/lib/mascote/voxel";
import { PARTE, type Estagio, type MascoteConfig, type Modelo, type Peca, type Pose } from "@/lib/mascote/tipos";

// Bicho em 3D (migration 043). three.js só por import() dinâmico, depois
// que o componente monta. Enquanto carrega, sem WebGL ou com erro, fica o
// <img> do SVG isométrico, que também é o que vai no HTML do servidor.
//
// Uma BufferGeometry por parte, só com as faces que aparecem, cor por
// vértice, MeshLambertMaterial. Câmera ortográfica isométrica girável por
// arrasto. Ocioso: respira (squash and stretch que preserva volume), pisca
// a cada 3 a 6 s e faz a pose; clique acena. Pausa fora da tela e com a
// aba escondida; prefers-reduced-motion deixa parado.

type Props = {
  config: MascoteConfig;
  itens?: Peca[];
  estagio?: Estagio;
  extras?: Peca[];
  /** lado em px (até 320) */
  tamanho?: number;
  /** gira devagar sozinho (o criador usa) */
  girar?: boolean;
  /** texto pra leitor de tela; padrão: nome do bicho */
  rotulo?: string;
  className?: string;
};

type Api = { setModelo: (m: Modelo, pose: Pose) => void; acenar: () => void };

function temWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}

const FACES: { n: [number, number, number]; c: [number, number, number][] }[] = [
  { n: [1, 0, 0], c: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { n: [-1, 0, 0], c: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 0, 1], c: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]] },
  { n: [0, 0, -1], c: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
];

export function MascoteViewer({ config, itens, estagio, extras, tamanho = 320, girar = false, rotulo, className = "" }: Props) {
  const lado = Math.min(320, tamanho);
  const modelo = useMemo(() => montar(config, { itens, estagio, extras }), [config, itens, estagio, extras]);
  const svg = useMemo(() => svgDataUri(toSvg(modelo, { tamanho: lado })), [modelo, lado]);
  const caixa = useRef<HTMLDivElement>(null);
  const api = useRef<Api | null>(null);
  const girarRef = useRef(girar);
  const [modo, setModo] = useState<"svg" | "3d">("svg");
  const ultimo = useRef<{ modelo: Modelo; pose: Pose } | null>(null);

  useEffect(() => {
    girarRef.current = girar;
  }, [girar]);

  useEffect(() => {
    ultimo.current = { modelo, pose: config.pose };
    api.current?.setModelo(modelo, config.pose);
  }, [modelo, config.pose]);

  useEffect(() => {
    const el = caixa.current;
    if (!el || !temWebGL()) return;
    let vivo = true;
    let limpar = () => {};
    import("three")
      .then((THREE) => {
        if (!vivo) return;
        try {
          if (!ultimo.current) return;
          limpar = iniciar(THREE, el, girarRef, ultimo.current, (a) => (api.current = a));
          setModo("3d");
        } catch (e) {
          console.error("[mascote] 3D indisponível", e);
          setModo("svg");
        }
      })
      .catch(() => setModo("svg"));
    return () => {
      vivo = false;
      api.current = null;
      limpar();
    };
  }, []);

  const nome = rotulo ?? `bicho ${config.nome}`;
  return (
    <div
      ref={caixa}
      className={`relative aspect-square w-full touch-pan-y select-none ${className}`}
      style={{ maxWidth: lado }}
      data-testid="mascote-viewer"
      data-modo={modo}
      role="img"
      aria-label={nome}
    >
      {modo === "svg" && (
        // eslint-disable-next-line @next/next/no-img-element -- SVG gerado aqui mesmo, data URI
        <img src={svg} alt="" className="absolute inset-0 h-full w-full object-contain" data-testid="mascote-svg" draggable={false} />
      )}
    </div>
  );
}

type Three = typeof import("three");

function iniciar(
  THREE: Three,
  el: HTMLDivElement,
  girarRef: { current: boolean },
  inicial: { modelo: Modelo; pose: Pose },
  pronto: (a: Api) => void,
): () => void {
  const reduzir = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.dataset.testid = "mascote-3d";
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;cursor:grab;";
  el.appendChild(canvas);

  const cena = new THREE.Scene();
  cena.add(new THREE.AmbientLight(0xffffff, 1.55));
  const sol = new THREE.DirectionalLight(0xffffff, 2.1);
  sol.position.set(3, 8, 5);
  cena.add(sol);
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 400);
  camera.position.set(60, 60 * 0.8165, 60);
  camera.lookAt(0, 0, 0);

  const giro = new THREE.Group(); // yaw do arrasto e da rotação
  cena.add(giro);
  let atual: { grupo: Group; geos: BufferGeometry[]; mats: Material[]; partes: Map<string, Group>; pivos: Map<string, Vector3> } | null = null;
  let pose: Pose = inicial.pose;

  function geometria(voxels: Modelo["partes"][number]["voxels"], occ: Set<string>, pivo: [number, number, number]) {
    const pos: number[] = [];
    const nor: number[] = [];
    const cor: number[] = [];
    const idx: number[] = [];
    const c = new THREE.Color();
    for (const [x, y, z, hex] of voxels) {
      c.set(hex);
      for (const f of FACES) {
        if (occ.has(`${x + f.n[0]},${y + f.n[1]},${z + f.n[2]}`)) continue;
        const base = pos.length / 3;
        for (const [cx, cy, cz] of f.c) {
          pos.push(x + cx - pivo[0], y + cy - pivo[1], z + cz - pivo[2]);
          nor.push(...f.n);
          cor.push(c.r, c.g, c.b);
        }
        idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(cor, 3));
    g.setIndex(idx);
    return g;
  }

  function setModelo(m: Modelo, p: Pose) {
    pose = p;
    if (atual) {
      giro.remove(atual.grupo);
      atual.geos.forEach((g) => g.dispose());
      atual.mats.forEach((x) => x.dispose());
    }
    const occ = new Set<string>();
    for (const parte of m.partes) for (const [x, y, z] of parte.voxels) occ.add(`${x},${y},${z}`);
    const grupo = new THREE.Group();
    const partes = new Map<string, Group>();
    const pivos = new Map<string, Vector3>();
    const geos: BufferGeometry[] = [];
    const mats: Material[] = [];
    const lo = new THREE.Vector3(Infinity, Infinity, Infinity);
    const hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
    m.partes.forEach((parte, nivel) => {
      // parte de depois ganha no empate de profundidade (olho pintado sobre o corpo)
      const mat = new THREE.MeshLambertMaterial({
        vertexColors: true,
        polygonOffset: nivel > 0,
        polygonOffsetFactor: -nivel,
        polygonOffsetUnits: -nivel * 2,
      });
      mats.push(mat);
      const geo = geometria(parte.voxels, occ, parte.pivo);
      geos.push(geo);
      const g = new THREE.Group();
      const pai = parte.pai ? partes.get(parte.pai) : undefined;
      const pivoPai = parte.pai ? pivos.get(parte.pai) : undefined;
      const pv = new THREE.Vector3(...parte.pivo);
      g.position.copy(pai && pivoPai ? pv.clone().sub(pivoPai) : pv);
      g.add(new THREE.Mesh(geo, mat));
      (pai ?? grupo).add(g);
      partes.set(parte.nome, g);
      pivos.set(parte.nome, pv);
      for (const [x, y, z] of parte.voxels) {
        lo.min(new THREE.Vector3(x, y, z));
        hi.max(new THREE.Vector3(x + 1, y + 1, z + 1));
      }
    });
    const centro = lo.clone().add(hi).multiplyScalar(0.5);
    grupo.position.set(-centro.x, -centro.y, -centro.z);
    giro.add(grupo);
    // enquadra: meia diagonal da caixa, com folga pra pular e acenar
    const r = hi.clone().sub(lo).length() * 0.5 + 1.5;
    camera.left = -r;
    camera.right = r;
    camera.top = r;
    camera.bottom = -r;
    camera.updateProjectionMatrix();
    atual = { grupo, geos, mats, partes, pivos };
    desenhar();
  }

  // ---------- animação ----------
  const relogio = new THREE.Clock();
  let yaw = 0;
  let proximaPiscada = 2 + Math.random() * 3;
  let piscandoAte = 0;
  let acenoDesde = -10;
  let proximoAceno = 1.2;
  let raf = 0;
  let visivel = !document.hidden;
  let naTela = true;
  let arrastando = false;
  let paradoAte = 0;

  function animar(t: number) {
    if (!atual) return;
    const corpo = atual.partes.get(PARTE.raiz);
    const pivo = atual.pivos.get(PARTE.raiz);
    const olhos = atual.partes.get(PARTE.olhos);
    const braco = atual.partes.get(PARTE.braco);
    if (!corpo || !pivo) return;
    // respira: e no eixo y, 1/√e nos outros dois (volume igual)
    let e = 1 + 0.035 * Math.sin((t * Math.PI * 2) / 1.7);
    let y = 0;
    let rz = 0;
    let ry = 0;
    if (pose === "pula") {
      const p = (t % 2.6) / 2.6;
      if (p < 0.08) e = 1 - 0.12 * Math.sin((p / 0.08) * Math.PI);
      else if (p < 0.4) {
        const q = (p - 0.08) / 0.32;
        y = Math.sin(q * Math.PI) * 2.2;
        e = 1.08;
      } else if (p < 0.48) e = 1 - 0.14 * Math.sin(((p - 0.4) / 0.08) * Math.PI);
    } else if (pose === "danca") {
      rz = 0.14 * Math.sin((t * Math.PI * 2) / 0.9);
      ry = 0.35 * Math.sin((t * Math.PI * 2) / 1.8);
      y = Math.abs(Math.sin((t * Math.PI * 2) / 0.9)) * 0.6;
    } else if (pose === "acena" && t > proximoAceno) {
      acenoDesde = t;
      proximoAceno = t + 4;
    }
    const s = 1 / Math.sqrt(e);
    corpo.scale.set(s, e, s);
    corpo.position.set(pivo.x, pivo.y + y, pivo.z);
    corpo.rotation.set(0, ry, rz);
    if (olhos) {
      if (t > proximaPiscada) {
        piscandoAte = t + 0.13;
        proximaPiscada = t + 3 + Math.random() * 3;
      }
      olhos.scale.y = t < piscandoAte ? 0.15 : 1;
    }
    if (braco) {
      const a = t - acenoDesde;
      braco.rotation.z = a >= 0 && a < 1.4 ? Math.min(1, a * 5, (1.4 - a) * 5) * (2.3 + 0.45 * Math.sin(a * 14)) : 0;
    }
  }

  function desenhar() {
    giro.rotation.y = yaw;
    renderer.render(cena, camera);
  }

  function quadro() {
    raf = 0;
    const t = relogio.getElapsedTime();
    if (girarRef.current && !arrastando && t > paradoAte) yaw += 0.006;
    animar(t);
    desenhar();
    agendar();
  }

  function agendar() {
    if (reduzir || raf || !visivel || !naTela) return;
    raf = requestAnimationFrame(quadro);
  }

  function parar() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  // ---------- tamanho, visibilidade e arrasto ----------
  const ajustar = () => {
    const w = el.clientWidth || 1;
    renderer.setSize(w, w, false);
    desenhar();
  };
  const ro = new ResizeObserver(ajustar);
  ro.observe(el);
  const io = new IntersectionObserver(([en]) => {
    naTela = en?.isIntersecting ?? true;
    if (naTela) agendar();
    else parar();
  });
  io.observe(el);
  const onVis = () => {
    visivel = !document.hidden;
    if (visivel) agendar();
    else parar();
  };
  document.addEventListener("visibilitychange", onVis);

  let x0 = 0;
  let moveu = 0;
  const down = (ev: PointerEvent) => {
    arrastando = true;
    moveu = 0;
    x0 = ev.clientX;
    canvas.setPointerCapture(ev.pointerId);
    canvas.style.cursor = "grabbing";
  };
  const move = (ev: PointerEvent) => {
    if (!arrastando) return;
    const dx = ev.clientX - x0;
    x0 = ev.clientX;
    moveu += Math.abs(dx);
    yaw += dx * 0.012;
    if (reduzir) desenhar();
  };
  const up = (ev: PointerEvent) => {
    if (!arrastando) return;
    arrastando = false;
    canvas.style.cursor = "grab";
    paradoAte = relogio.getElapsedTime() + 3;
    if (canvas.hasPointerCapture(ev.pointerId)) canvas.releasePointerCapture(ev.pointerId);
    if (moveu < 4) acenar();
  };
  canvas.addEventListener("pointerdown", down);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);

  function acenar() {
    acenoDesde = relogio.getElapsedTime();
    if (reduzir) desenhar();
  }

  setModelo(inicial.modelo, inicial.pose);
  ajustar();
  agendar();
  pronto({ setModelo, acenar });

  return () => {
    parar();
    ro.disconnect();
    io.disconnect();
    document.removeEventListener("visibilitychange", onVis);
    canvas.removeEventListener("pointerdown", down);
    canvas.removeEventListener("pointermove", move);
    canvas.removeEventListener("pointerup", up);
    canvas.removeEventListener("pointercancel", up);
    if (atual) {
      atual.geos.forEach((g) => g.dispose());
      atual.mats.forEach((x) => x.dispose());
    }
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
  };
}
