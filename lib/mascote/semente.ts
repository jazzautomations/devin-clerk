import { ESPECIE_DEFS } from "@/lib/mascote/especies";
import { COR_IDS } from "@/lib/mascote/paleta";
import { lerMascoteSalvo } from "@/lib/mascote/validar";
import { ACESSORIOS, BOCAS, ESPECIES, MAOS, OLHOS, POSES, ROUPAS, TOPOS, type MascoteConfig } from "@/lib/mascote/tipos";

// Bicho da semente (migration 043): quem não montou ganha um gerado pelo
// id, sempre o mesmo. Nunca quadrado cinza.

/** mulberry32: PRNG de 32 bits, determinístico e igual em server e client */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 40 nomes curtos, todos nossos */
export const NOMES = [
  "Bit",
  "Byte",
  "Pixel",
  "Tico",
  "Teco",
  "Nina",
  "Juca",
  "Bolota",
  "Pipoca",
  "Farofa",
  "Paçoca",
  "Biscoito",
  "Chico",
  "Lola",
  "Zeca",
  "Tutu",
  "Mimi",
  "Dudu",
  "Bento",
  "Kiko",
  "Lua",
  "Nico",
  "Pingo",
  "Fubá",
  "Quindim",
  "Cuscuz",
  "Jujuba",
  "Tapioca",
  "Bolacha",
  "Cacau",
  "Toco",
  "Pudim",
  "Caju",
  "Pitoco",
  "Xodó",
  "Batata",
  "Bug",
  "Cookie",
  "Miojo",
  "Sushi",
] as const;

function pick<T>(r: () => number, xs: readonly T[]): T {
  return xs[Math.floor(r() * xs.length) % xs.length];
}

/** chance de vir sem nada: a semente não enche o bicho de tralha */
function talvez<T extends string>(r: () => number, xs: readonly T[], chance: number): T {
  return r() < chance ? pick(r, xs.filter((x) => x !== "nada")) : ("nada" as T);
}

export function configFromSeed(memberId: number): MascoteConfig {
  const r = mulberry32((Math.imul(memberId | 0, 2654435761) ^ 0x9e3779b9) >>> 0);
  const especie = pick(r, ESPECIES);
  const [pref, prefDet] = ESPECIE_DEFS[especie].cores;
  // metade das vezes a cor da espécie, metade uma da paleta
  const corPrincipal = r() < 0.5 ? pref : pick(r, COR_IDS);
  let corDetalhe = r() < 0.5 ? prefDet : pick(r, COR_IDS);
  if (corDetalhe === corPrincipal) corDetalhe = corPrincipal === "tinta" ? "banda" : "tinta";
  return {
    v: 1,
    especie,
    corPrincipal,
    corDetalhe,
    olhos: pick(r, OLHOS),
    boca: pick(r, BOCAS),
    topo: talvez(r, TOPOS, 0.35),
    roupa: talvez(r, ROUPAS, 0.25),
    mao: talvez(r, MAOS, 0.25),
    acessorio: talvez(r, ACESSORIOS, 0.25),
    pose: pick(r, POSES),
    cenario: "nada",
    nome: pick(r, NOMES),
  };
}

/** config sorteado (o dado do criador); r = Math.random por padrão */
export function sortearConfig(r: () => number = Math.random, nome?: string): MascoteConfig {
  return { ...configFromSeed(Math.floor(r() * 2 ** 31)), nome: nome ?? pick(r, NOMES) };
}

export function sortearNome(r: () => number = Math.random, atual?: string): string {
  const opcoes = NOMES.filter((n) => n !== atual);
  return pick(r, opcoes);
}

/** o bicho de um membro: o salvo, se válido; senão o da semente */
export function resolveMascote(member: { id: number; mascote?: string | null }): MascoteConfig {
  return lerMascoteSalvo(member.mascote) ?? configFromSeed(member.id);
}
