import type { ParteDef, Primitiva } from "@/lib/mascote/tipos";

// Pedaços repetidos entre espécies (só dado: cada espécie decide onde).

/** braço de 1x2 voxels; o direito ('braco-d') é o que acena e segura o item da mão */
export function braco(lado: "e" | "d", x: number, y: number, z = 7, pai = "corpo"): ParteDef {
  return {
    nome: `braco-${lado}`,
    pai,
    escala: "corpo",
    pivo: [lado === "d" ? x : x + 1, y + 1, z + 0.5],
    primitivas: [{ tipo: "caixa", de: [x, y - 1, z], ate: [x, y, z], cor: "corpo" }],
  };
}

/** dois pés escuros na altura 0 */
export function pes(z0: number, z1: number, xs: [number, number][] = [[4, 5], [9, 10]]): Primitiva[] {
  return xs.map(([a, b]) => ({ tipo: "caixa", de: [a, 0, z0], ate: [b, 0, z1], cor: "escuro" }) as Primitiva);
}
