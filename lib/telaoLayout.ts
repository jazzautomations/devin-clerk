// Salão do telão (spec 046, onda 4 — telao-e-bicho-do-time): onde cada
// bicho fica na ilha isométrica. Módulo PURO (sem banco, sem three.js, sem
// React): o mesmo plano roda no servidor, no cliente 3D e no teste.
//
// Regras do desenho:
// - quem não tem time fica na "praça", no meio da ilha, em espiral;
// - quem tem time fica junto do time, num arco curto em volta da bandeira;
// - a bandeira é do time: baixa (y baixo) até entregar, alta depois da
//   entrega — é o que o telão mostra acontecendo ao vivo;
// - limite de performance MENSURÁVEL: só os primeiros MAX_MALHA bichos
//   viram malha 3D de verdade (montar() + BufferGeometry); do 61º em diante
//   são sprites billboard. Com 300 presentes a cena tem 60 malhas e 240
//   sprites, nunca 300 malhas.
//
// Determinismo: times ordenados por id, gente por memberId, posições em
// fórmulas fechadas (nada de Math.random). O mesmo JSON dá o mesmo desenho
// em qualquer processo e em qualquer refresh.

/** teto de malhas 3D na cena — medido no unit com 300 bichos */
export const MAX_MALHA = 60;

/** teto de bichos que a API devolve (o resto é contagem) */
export const SALAO_MAX = 300;

export type SalaoBicho = {
  memberId: number;
  primeiroNome: string;
  src: string;
  teamId: number | null;
};

export type SalaoTime = {
  id: number;
  name: string;
  delivered: boolean;
  src: string;
};

export type BichoNoSalao = SalaoBicho & {
  modo: "malha" | "sprite";
  /** posição no chão da ilha, em células (centro = 0,0) */
  x: number;
  z: number;
  /** giro em radianos: cada bicho olha pro meio da ilha */
  giro: number;
};

export type BandeiraNoSalao = {
  teamId: number;
  name: string;
  src: string;
  /** true = o time entregou e a bandeira sobe */
  alta: boolean;
  x: number;
  z: number;
  /** altura da bandeira acima do chão, em células */
  y: number;
};

export type PlanoSalao = {
  bichos: BichoNoSalao[];
  bandeiras: BandeiraNoSalao[];
  malhas: number;
  sprites: number;
  /** lado da ilha em células (quadrada) — o 3D desenha o chão por aqui */
  lado: number;
};

const BANDEIRA_ALTA = 3.2;
const BANDEIRA_BAIXA = 1.2;
const RAIO_PRACA = 2;
const PASSO_PRACA = 1.6;
/** raio do arco em volta da bandeira: cabe um bicho de ~1,5 célula de largura */
const RAIO_TIME = 2.8;
const ANGULO_OURO = 2.399963229728653;

const r2 = (n: number) => Math.round(n * 100) / 100;

/** ângulo de quem está em (x,z) olhando pro centro da ilha */
function olharProCentro(x: number, z: number): number {
  if (x === 0 && z === 0) return 0;
  return r2(Math.atan2(-x, -z));
}

/**
 * Plano do salão: posições na ilha e o modo de cada bicho. `bichos` chega
 * como a API devolve (só quem consentiu); `teams` é o catálogo dos times
 * que têm alguém presente.
 */
export function planSalao(bichos: SalaoBicho[], teams: SalaoTime[]): PlanoSalao {
  const porTime = new Map<number, SalaoBicho[]>();
  const praca: SalaoBicho[] = [];
  for (const b of bichos) {
    if (b.teamId === null) praca.push(b);
    else {
      const arr = porTime.get(b.teamId);
      if (arr) arr.push(b);
      else porTime.set(b.teamId, [b]);
    }
  }
  const byId = new Map(teams.map((t) => [t.id, t]));
  const ids = [...porTime.keys()].sort((a, b) => a - b);
  for (const arr of porTime.values()) arr.sort((a, b) => a.memberId - b.memberId);
  praca.sort((a, b) => a.memberId - b.memberId);

  // times num anel; com muitos times o anel abre (e a ilha cresce junto)
  const nTimes = ids.length;
  const raioTimes = nTimes === 0 ? 0 : Math.min(20, 6 + 1.15 * nTimes);
  const bandeiras: BandeiraNoSalao[] = [];
  const posicionados: { bicho: SalaoBicho; x: number; z: number }[] = [];

  ids.forEach((teamId, i) => {
    const t = byId.get(teamId);
    const a = nTimes === 1 ? 0 : (2 * Math.PI * i) / nTimes + Math.PI / 2;
    const cx = r2(Math.cos(a) * raioTimes);
    const cz = r2(Math.sin(a) * raioTimes);
    const membros = porTime.get(teamId)!;
    bandeiras.push({
      teamId,
      name: t?.name ?? "time",
      src: t?.src ?? "",
      alta: t?.delivered === true,
      x: cx,
      z: cz,
      y: t?.delivered === true ? BANDEIRA_ALTA : BANDEIRA_BAIXA,
    });
    // arco curto em volta da bandeira: o time fica legível como grupo
    const k = membros.length;
    membros.forEach((bicho, j) => {
      const ab = k === 1 ? 0 : (j - (k - 1) / 2) * Math.min(0.6, 2.4 / k);
      const x = r2(cx + Math.cos(a + ab + Math.PI) * RAIO_TIME);
      const z = r2(cz + Math.sin(a + ab + Math.PI) * RAIO_TIME);
      posicionados.push({ bicho, x, z });
    });
  });

  // praça: espiral de ângulo áureo, densa e sem buraco no meio
  praca.forEach((bicho, k) => {
    const r = k === 0 ? 0 : r2(RAIO_PRACA + PASSO_PRACA * Math.sqrt(k));
    const a = k * ANGULO_OURO;
    posicionados.push({ bicho, x: r2(Math.cos(a) * r), z: r2(Math.sin(a) * r) });
  });

  // ordem de desenho: times (por id) e depois a praça — os 60 primeiros
  // viram malha, o resto sprite
  const bichosNoSalao: BichoNoSalao[] = posicionados.map((p, i) => ({
    ...p.bicho,
    modo: i < MAX_MALHA ? "malha" : "sprite",
    x: p.x,
    z: p.z,
    giro: olharProCentro(p.x, p.z),
  }));

  const alcance = Math.max(
    raioTimes + 3,
    bichosNoSalao.reduce((m, b) => Math.max(m, Math.hypot(b.x, b.z)), 0) + 2,
    8,
  );
  const lado = Math.min(64, Math.ceil((alcance * 2) / 2) * 2);

  return {
    bichos: bichosNoSalao,
    bandeiras,
    malhas: bichosNoSalao.filter((b) => b.modo === "malha").length,
    sprites: bichosNoSalao.filter((b) => b.modo === "sprite").length,
    lado,
  };
}
