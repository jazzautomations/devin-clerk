import type { EspecieDef } from "@/lib/mascote/tipos";
import { braco } from "@/lib/mascote/especies/comum";

// fatia de pizza de ponta pra baixo, borda em cima
const pizza: EspecieDef = {
  id: "pizza",
  nome: "pizza",
  frase: "Aparece às 2h da manhã e salva o time.",
  cores: ["amarelo", "laranja"],
  partes: [
    {
      nome: "corpo",
      pivo: [7.5, 0, 7.5],
      escala: "corpo",
      primitivas: [
        { tipo: "caixa", de: [7, 1, 6], ate: [7, 1, 8] },
        { tipo: "caixa", de: [6, 2, 6], ate: [8, 3, 8] },
        { tipo: "caixa", de: [5, 4, 6], ate: [9, 5, 8] },
        { tipo: "caixa", de: [4, 6, 6], ate: [10, 7, 8] },
        { tipo: "caixa", de: [3, 8, 6], ate: [11, 9, 8] },
        { tipo: "caixa", de: [3, 10, 5], ate: [11, 11, 9], cor: "detalhe" },
        {
          tipo: "pontos",
          pontos: [
            [4, 8, 8],
            [10, 6, 8],
            [7, 2, 8],
            [5, 6, 6],
            [9, 8, 6],
          ],
          cor: "#c8362b",
        },
        {
          tipo: "pontos",
          pontos: [
            [6, 0, 7],
            [8, 0, 7],
          ],
          cor: "escuro",
        },
      ],
    },
    braco("e", 3, 7),
    braco("d", 11, 7),
  ],
  encaixes: {
    topo: { pos: [7, 12, 7], normal: [0, 1, 0], parte: "corpo" },
    olhos: { pos: [7, 9, 9], normal: [0, 0, 1], parte: "corpo" },
    peito: { pos: [7, 3, 9], normal: [0, 0, 1], parte: "corpo" },
    costas: { pos: [7, 6, 5], normal: [0, 0, -1], parte: "corpo" },
    mao: { pos: [12, 6, 7], normal: [1, 0, 0], parte: "braco-d" },
  },
};

export default pizza;
