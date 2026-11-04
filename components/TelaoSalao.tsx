"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { BufferGeometry, Group, Mesh, Sprite, SpriteMaterial, Texture } from "three";
import { montar } from "@/lib/mascote/voxel";
import type { MascoteConfig, Voxel } from "@/lib/mascote/tipos";
import type { Salao } from "@/lib/salao";
import { planSalao, type BichoNoSalao, type BandeiraNoSalao, type PlanoSalao } from "@/lib/telaoLayout";

// Salão do telão (spec 046, onda 4 — telao-e-bicho-do-time). A ilha
// isométrica com os bichos de quem fez check-in e topou aparecer, agrupados
// por time, com a bandeira de cada time e os contadores do rodapé.
//
// Regras de performance (medidas em lib/telaoLayout, MAX_MALHA = 60):
// - os primeiros 60 bichos são MALHA de verdade (montar() → BufferGeometry,
//   um mesh por bicho, material compartilhado);
// - do 61º em diante são SPRITES billboard com CanvasTexture desenhada do
//   SVG (uma textura por bicho, sem geometria de voxel);
// - a ilha é um único mesh; as bandeiras, um sprite cada.
// O que anima é só o que o telão precisa contar: o bicho que CHEGA pula
// (0,8s) e a bandeira do time SOBE quando ele entrega.
//
// three.js entra por import() dinâmico. Sem WebGL (ou com erro), a tela cai
// na grade de <img> do mesmo jeito que o bicho do perfil — o telão nunca
// fica em branco. prefers-reduced-motion: cena estática, só atualiza dado.

const POLL_MS = 10_000;
/** escala do bicho na ilha: a grade do modelo é 16, a célula da ilha é 1 */
const ESCALA = 0.09;
const SPRITE_LADO = 1.8;
const PULO_S = 0.8;

type Three = typeof import("three");

/** por que duplica: MascoteViewer é da onda 4 (bicho-avatar) e não se edita aqui */
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

export function TelaoSalao({ hackathonId, initial }: { hackathonId: string; initial: Salao | null }) {
  const [salao, setSalao] = useState<Salao | null>(initial);
  const caixa = useRef<HTMLDivElement>(null);
  const [modo, setModo] = useState<"3d" | "grade">("grade");
  const plano = useMemo(() => planSalao(salao?.bichos ?? [], salao?.teams ?? []), [salao]);
  const configs = useMemo(() => salao?.configs ?? {}, [salao]);

  // polling de 10s: o salão muda com o check-in, e check-in não tem SSE
  useEffect(() => {
    let vivo = true;
    const busca = async () => {
      try {
        const r = await fetch(`/api/hackathons/${hackathonId}/salao`, { cache: "no-store" });
        if (r.ok && vivo) setSalao((await r.json()) as Salao);
      } catch {
        // sem rede: segue com o último salão na tela
      }
    };
    if (!initial) void busca();
    const id = setInterval(busca, POLL_MS);
    return () => {
      vivo = false;
      clearInterval(id);
    };
  }, [hackathonId, initial]);

  const cena = useRef<Api | null>(null);
  const dados = useRef({ plano, configs });

  useEffect(() => {
    dados.current = { plano, configs };
    cena.current?.atualizar(plano, configs);
  }, [plano, configs]);

  useEffect(() => {
    const el = caixa.current;
    if (!el || !temWebGL()) return;
    let vivo = true;
    let limpar = () => {};
    import("three")
      .then((THREE) => {
        if (!vivo) return;
        try {
          limpar = iniciar(THREE, el, dados.current.plano, dados.current.configs, (api) => {
            cena.current = api;
            setModo("3d");
          });
        } catch (e) {
          console.error("[salão] 3D indisponível", e);
          setModo("grade");
        }
      })
      .catch(() => setModo("grade"));
    return () => {
      vivo = false;
      cena.current = null;
      limpar();
    };
  }, []);

  const presentes = salao?.presentes ?? 0;
  const times = salao?.times ?? 0;
  const entregas = salao?.entregas ?? 0;
  const bichos = salao?.bichos ?? [];

  return (
    <section
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden border-2 border-line bg-foreground"
      data-testid="telao-salao"
      data-modo={modo}
      data-bichos={bichos.length}
      aria-label="salão com os bichos de quem está presente"
    >
      <div ref={caixa} className="relative min-h-0 flex-1">
        {modo === "grade" && (
          <div className="h-full w-full overflow-auto p-[1.2vw]" data-testid="telao-salao-grade">
            {bichos.length === 0 ? (
              <p className="pix flex h-full items-center justify-center text-[2.4vw] text-muted">
                ninguém no salão ainda
              </p>
            ) : (
              <ul className="flex flex-wrap content-start justify-center gap-[0.8vw]">
                {bichos.map((b) => (
                  <li key={b.memberId} className="flex w-[5.2vw] min-w-14 flex-col items-center gap-[0.2vw]">
                    {/* eslint-disable-next-line @next/next/no-img-element -- SVG gerado pela rota do bicho */}
                    <img src={b.src} alt="" className="aspect-square w-full" loading="lazy" />
                    <span className="w-full truncate text-center font-mono text-[0.8vw] text-band">
                      {b.primeiroNome}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      <footer
        className="strip flex shrink-0 items-center gap-[1.6vw] px-[1.2vw] py-[0.4vw] text-[clamp(18px,1.5vw,36px)]!"
        data-testid="salao-contadores"
      >
        <span>
          {presentes} {presentes === 1 ? "presente" : "presentes"}
        </span>
        <span aria-hidden>·</span>
        <span>
          {times} {times === 1 ? "time" : "times"}
        </span>
        <span aria-hidden>·</span>
        <span>
          {entregas} {entregas === 1 ? "entrega" : "entregas"}
        </span>
        <span className="ml-auto font-mono text-[0.75em] text-background">
          {modo === "3d" ? "salão ao vivo" : "salão sem WebGL"}
        </span>
      </footer>
    </section>
  );
}

// ---------- cena ----------

type Api = { atualizar: (p: PlanoSalao, c: Record<number, MascoteConfig>) => void; destruir: () => void };

type Malha = { mesh: Mesh; desde: number };
type Sprite3d = { sprite: Sprite; mat: SpriteMaterial; tex: Texture | null; desde: number };
type Bandeira3d = { grupo: Group; geo: BufferGeometry[]; mat: SpriteMaterial; tex: Texture | null };

function geometria(THREE: Three, voxels: Voxel[], occ: Set<string>, desloc: [number, number, number]) {
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
        pos.push(x + cx - desloc[0], y + cy - desloc[1], z + cz - desloc[2]);
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

/** chão da ilha: célula a célula, borda escura e xadrez discreto (cara de voxel) */
function voxelsIlha(lado: number): Voxel[] {
  const out: Voxel[] = [];
  const meio = lado / 2;
  for (let x = -meio; x < meio; x++) {
    for (let z = -meio; z < meio; z++) {
      const borda = Math.abs(x) >= meio - 1 || Math.abs(z) >= meio - 1;
      const xadrez = (Math.abs(x) + Math.abs(z)) % 2 === 0;
      out.push([x, -1, z, borda ? "#1b1f24" : xadrez ? "#2f3a34" : "#28302c"]);
    }
  }
  return out;
}

function iniciar(
  THREE: Three,
  el: HTMLDivElement,
  planoInicial: PlanoSalao,
  configsIniciais: Record<number, MascoteConfig>,
  pronto: (api: Api) => void,
): () => void {
  const reduzir = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x0c0c0c, 1);
  const canvas = renderer.domElement;
  canvas.dataset.testid = "telao-salao-3d";
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;";
  el.appendChild(canvas);

  const cena = new THREE.Scene();
  cena.add(new THREE.AmbientLight(0xffffff, 1.6));
  const sol = new THREE.DirectionalLight(0xffffff, 2.1);
  sol.position.set(6, 12, 8);
  cena.add(sol);
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 800);
  camera.position.set(40, 38, 40);
  camera.lookAt(0, 0, 0);
  const giro = new THREE.Group();
  cena.add(giro);

  const matBicho = new THREE.MeshLambertMaterial({ vertexColors: true });
  const matMastro = new THREE.MeshLambertMaterial({ color: 0x1d1d1f });

  let plano = planoInicial;
  let configs = configsIniciais;
  let ilha: { mesh: Mesh; geo: BufferGeometry; lado: number } | null = null;
  const malhas = new Map<number, Malha>();
  const sprites = new Map<number, Sprite3d>();
  const bandeiras = new Map<number, Bandeira3d>();
  const geosPorMembro = new Map<number, BufferGeometry>();

  const relogio = new THREE.Clock();
  let raf = 0;
  let naTela = true;
  let visivel = !document.hidden;
  let yaw = 0;

  function desenhar() {
    giro.rotation.y = yaw;
    renderer.render(cena, camera);
  }

  function ajustarCamera() {
    const w = el.clientWidth || 1;
    const h = el.clientHeight || 1;
    const r = Math.max(10, plano.lado * 0.7);
    const aspecto = w / h;
    camera.left = -r * Math.max(1, aspecto);
    camera.right = r * Math.max(1, aspecto);
    camera.top = r * Math.max(1, 1 / aspecto);
    camera.bottom = -r * Math.max(1, 1 / aspecto);
    camera.updateProjectionMatrix();
  }

  function montarIlha() {
    if (ilha && ilha.lado === plano.lado) return;
    if (ilha) {
      giro.remove(ilha.mesh);
      ilha.geo.dispose();
    }
    const voxels = voxelsIlha(plano.lado);
    const occ = new Set(voxels.map(([x, y, z]) => `${x},${y},${z}`));
    const geo = geometria(THREE, voxels, occ, [0, 0, 0]);
    const mesh = new THREE.Mesh(geo, matBicho);
    giro.add(mesh);
    ilha = { mesh, geo, lado: plano.lado };
  }

  /** desenha o SVG do bicho/time num canvas e devolve a textura (assíncrono) */
  function textura(src: string, ao: (t: Texture) => void) {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = 192;
      c.height = 192;
      const ctx = c.getContext("2d");
      if (ctx) ctx.drawImage(img, 0, 0, c.width, c.height);
      const t = new THREE.CanvasTexture(c);
      t.needsUpdate = true;
      ao(t);
      if (reduzir) desenhar();
    };
    img.src = src;
  }

  function criaMalha(b: BichoNoSalao) {
    let geo = geosPorMembro.get(b.memberId);
    if (!geo) {
      const config = configs[b.memberId];
      if (!config) return false;
      const modelo = montar(config);
      const voxels = modelo.partes.flatMap((p) => p.voxels);
      const occ = new Set(voxels.map(([x, y, z]) => `${x},${y},${z}`));
      geo = geometria(THREE, voxels, occ, [8, 0, 8]);
      geosPorMembro.set(b.memberId, geo);
    }
    const mesh = new THREE.Mesh(geo, matBicho);
    mesh.scale.setScalar(ESCALA);
    mesh.position.set(b.x, 0, b.z);
    mesh.rotation.y = b.giro;
    giro.add(mesh);
    malhas.set(b.memberId, { mesh, desde: relogio.getElapsedTime() });
    return true;
  }

  function criaSprite(b: BichoNoSalao) {
    const mat = new THREE.SpriteMaterial({ transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(SPRITE_LADO, SPRITE_LADO, 1);
    sprite.position.set(b.x, SPRITE_LADO / 2, b.z);
    giro.add(sprite);
    const item: Sprite3d = { sprite, mat, tex: null, desde: relogio.getElapsedTime() };
    sprites.set(b.memberId, item);
    textura(b.src, (t) => {
      item.tex = t;
      mat.map = t;
      mat.needsUpdate = true;
      if (reduzir) desenhar();
    });
  }

  function criaBandeira(b: BandeiraNoSalao) {
    const grupo = new THREE.Group();
    const mastro = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1, 0.14), matMastro);
    mastro.position.set(0, 0.5, 0);
    grupo.add(mastro);
    const mat = new THREE.SpriteMaterial({ transparent: true, depthWrite: false });
    const pano = new THREE.Sprite(mat);
    pano.scale.set(2.2, 2.2, 1);
    pano.position.set(0, 1.3, 0);
    grupo.add(pano);
    grupo.position.set(b.x, 0, b.z);
    grupo.scale.y = b.y;
    giro.add(grupo);
    const item: Bandeira3d = { grupo, geo: [mastro.geometry], mat, tex: null };
    bandeiras.set(b.teamId, item);
    textura(b.src, (t) => {
      item.tex = t;
      mat.map = t;
      mat.needsUpdate = true;
      if (reduzir) desenhar();
    });
  }

  function removerSprite(id: number) {
    const s = sprites.get(id);
    if (!s) return;
    giro.remove(s.sprite);
    s.mat.dispose();
    s.tex?.dispose();
    sprites.delete(id);
  }

  function removerBandeira(id: number) {
    const b = bandeiras.get(id);
    if (!b) return;
    giro.remove(b.grupo);
    b.geo.forEach((g) => g.dispose());
    b.mat.dispose();
    b.tex?.dispose();
    bandeiras.delete(id);
  }

  function atualizar(p: PlanoSalao, c: Record<number, MascoteConfig>) {
    plano = p;
    configs = c;
    montarIlha();
    ajustarCamera();
    const porId = new Map(p.bichos.map((b) => [b.memberId, b]));

    // 1. quem saiu do salão (ou trocou de modo) sai da cena
    for (const [id, m] of malhas) {
      const b = porId.get(id);
      if (!b || b.modo !== "malha") {
        giro.remove(m.mesh);
        malhas.delete(id);
      }
    }
    for (const id of [...sprites.keys()]) {
      const b = porId.get(id);
      if (!b || b.modo !== "sprite") removerSprite(id);
    }

    // 2. posição de quem ficou e entrada de quem chegou
    for (const b of p.bichos) {
      const m = malhas.get(b.memberId);
      if (m) {
        m.mesh.position.x = b.x;
        m.mesh.position.z = b.z;
        m.mesh.rotation.y = b.giro;
        continue;
      }
      const s = sprites.get(b.memberId);
      if (s) {
        s.sprite.position.x = b.x;
        s.sprite.position.z = b.z;
        continue;
      }
      if (b.modo === "malha" && criaMalha(b)) continue;
      criaSprite(b);
    }

    // 3. bandeiras: some com quem saiu, sobe a de quem entregou
    const timesVivos = new Set(p.bandeiras.map((b) => b.teamId));
    for (const id of [...bandeiras.keys()]) if (!timesVivos.has(id)) removerBandeira(id);
    for (const b of p.bandeiras) {
      const item = bandeiras.get(b.teamId);
      if (!item) {
        criaBandeira(b);
        continue;
      }
      item.grupo.position.x = b.x;
      item.grupo.position.z = b.z;
      item.grupo.scale.y = b.y;
    }

    if (reduzir) desenhar();
    else agendar();
  }

  function animar(t: number) {
    // pulo de chegada: 0,8s de arco, só pro bicho que acabou de entrar
    for (const m of malhas.values()) {
      const p = Math.min(1, (t - m.desde) / PULO_S);
      m.mesh.position.y = p < 1 ? Math.sin(p * Math.PI) * 1.1 : 0;
    }
    for (const s of sprites.values()) {
      const p = Math.min(1, (t - s.desde) / PULO_S);
      s.sprite.position.y = SPRITE_LADO / 2 + (p < 1 ? Math.sin(p * Math.PI) * 1.1 : 0);
    }
  }

  function quadro() {
    raf = 0;
    const t = relogio.getElapsedTime();
    yaw = Math.sin(t * 0.12) * 0.06; // balanço lento: a ilha parece viva, sem distrair
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

  const ajustar = () => {
    renderer.setSize(el.clientWidth || 1, el.clientHeight || 1, false);
    ajustarCamera();
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

  function destruir() {
    parar();
    ro.disconnect();
    io.disconnect();
    document.removeEventListener("visibilitychange", onVis);
    geosPorMembro.forEach((g) => g.dispose());
    geosPorMembro.clear();
    malhas.clear();
    for (const id of [...sprites.keys()]) removerSprite(id);
    for (const id of [...bandeiras.keys()]) removerBandeira(id);
    if (ilha) {
      giro.remove(ilha.mesh);
      ilha.geo.dispose();
      ilha = null;
    }
    matBicho.dispose();
    matMastro.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
  }

  atualizar(planoInicial, configsIniciais);
  ajustar();
  agendar();
  pronto({ atualizar, destruir });

  return destruir;
}
