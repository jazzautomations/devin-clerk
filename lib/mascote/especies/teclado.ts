import type { EspecieDef, Vec3 } from "@/lib/mascote/tipos";
import { braco, pes } from "@/lib/mascote/especies/comum";

// teclado: bloco largo com as teclas em cima e a barra de espaço na frente
const teclas: Vec3[] = [];
for (const x of [3, 5, 7, 9, 11]) for (const z of [4, 6, 8]) teclas.push([x, 9, z]);

const teclado: EspecieDef = {
  id: "teclado",
  nome: "teclado",
  frase: "Digita antes de pensar e acerta.",
  cores: ["tinta", "banda"],
  partes: [
    {
      nome: "corpo",
      pivo: [7.5, 0, 7.5],
      escala: "corpo",
      primitivas: [
        { tipo: "caixa", de: [2, 1, 3], ate: [12, 8, 11] },
        { tipo: "pontos", pontos: teclas, cor: "detalhe" },
        { tipo: "caixa", de: [5, 9, 10], ate: [9, 9, 10], cor: "claro" },
        ...pes(5, 9, [
          [3, 4],
          [10, 11],
        ]),
      ],
    },
    braco("e", 1, 5),
    braco("d", 13, 5),
  ],
  encaixes: {
    topo: { pos: [7, 10, 7], normal: [0, 1, 0], parte: "corpo" },
    olhos: { pos: [7, 7, 12], normal: [0, 0, 1], parte: "corpo" },
    peito: { pos: [7, 2, 12], normal: [0, 0, 1], parte: "corpo" },
    costas: { pos: [7, 5, 2], normal: [0, 0, -1], parte: "corpo" },
    mao: { pos: [14, 4, 7], normal: [1, 0, 0], parte: "braco-d" },
  },
};

export default teclado;
