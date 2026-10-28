import type { EspecieDef } from "@/lib/mascote/tipos";
import { braco, pes } from "@/lib/mascote/especies/comum";

// servidor de torre: baias na frente, ventilação em cima, LED aceso
const servidor: EspecieDef = {
  id: "servidor",
  nome: "servidor",
  frase: "Nunca cai. Quase nunca.",
  cores: ["tinta", "banda"],
  partes: [
    {
      nome: "corpo",
      pivo: [7.5, 0, 7.5],
      escala: "corpo",
      primitivas: [
        { tipo: "caixa", de: [3, 1, 4], ate: [11, 11, 10] },
        { tipo: "caixa", de: [4, 2, 10], ate: [10, 2, 10], cor: "escuro" },
        { tipo: "caixa", de: [4, 4, 10], ate: [10, 4, 10], cor: "escuro" },
        { tipo: "pontos", pontos: [[10, 3, 10]], cor: "detalhe" },
        {
          tipo: "pontos",
          pontos: [
            [4, 11, 5],
            [6, 11, 5],
            [8, 11, 5],
            [10, 11, 5],
            [4, 11, 7],
            [6, 11, 7],
            [8, 11, 7],
            [10, 11, 7],
          ],
          cor: "detalhe-escuro",
        },
        {
          tipo: "pontos",
          pontos: [
            [11, 9, 5],
            [11, 9, 7],
            [11, 7, 5],
            [11, 7, 7],
          ],
          cor: "escuro",
        },
        ...pes(5, 9),
      ],
    },
    braco("e", 2, 7),
    braco("d", 12, 7),
  ],
  encaixes: {
    topo: { pos: [7, 12, 7], normal: [0, 1, 0], parte: "corpo" },
    olhos: { pos: [7, 9, 11], normal: [0, 0, 1], parte: "corpo" },
    peito: { pos: [7, 4, 11], normal: [0, 0, 1], parte: "corpo" },
    costas: { pos: [7, 6, 3], normal: [0, 0, -1], parte: "corpo" },
    mao: { pos: [13, 6, 7], normal: [1, 0, 0], parte: "braco-d" },
  },
};

export default servidor;
