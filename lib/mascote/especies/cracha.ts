import type { EspecieDef } from "@/lib/mascote/tipos";
import { braco, pes } from "@/lib/mascote/especies/comum";

// crachá de evento: cartão fino com a faixa de cima na cor de detalhe
const cracha: EspecieDef = {
  id: "cracha",
  nome: "crachá",
  frase: "Chega cedo e lembra o nome de todo mundo.",
  cores: ["papel", "banda"],
  partes: [
    {
      nome: "corpo",
      pivo: [7.5, 0, 7.5],
      escala: "corpo",
      primitivas: [
        { tipo: "caixa", de: [3, 1, 6], ate: [11, 11, 8] },
        { tipo: "caixa", de: [3, 10, 6], ate: [11, 11, 8], cor: "detalhe" },
        { tipo: "caixa", de: [6, 10, 6], ate: [8, 10, 8], apagar: true },
        { tipo: "caixa", de: [5, 2, 8], ate: [9, 2, 8], cor: "escuro" },
        ...pes(6, 8),
      ],
    },
    braco("e", 2, 6),
    braco("d", 12, 6),
  ],
  encaixes: {
    topo: { pos: [7, 12, 7], normal: [0, 1, 0], parte: "corpo" },
    olhos: { pos: [7, 8, 9], normal: [0, 0, 1], parte: "corpo" },
    peito: { pos: [7, 3, 9], normal: [0, 0, 1], parte: "corpo" },
    costas: { pos: [7, 6, 5], normal: [0, 0, -1], parte: "corpo" },
    mao: { pos: [13, 5, 7], normal: [1, 0, 0], parte: "braco-d" },
  },
};

export default cracha;
