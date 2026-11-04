import type { EspecieDef } from "@/lib/mascote/tipos";
import { braco, pes } from "@/lib/mascote/especies/comum";

// mouse: comprido e baixo, rodinha em cima e o fio saindo por trás
const mouse: EspecieDef = {
  id: "mouse",
  nome: "mouse",
  frase: "Clica em tudo pra ver o que acontece.",
  cores: ["ceu", "tinta"],
  partes: [
    {
      nome: "corpo",
      pivo: [7.5, 0, 7.5],
      escala: "corpo",
      primitivas: [
        { tipo: "caixa", de: [3, 1, 2], ate: [11, 7, 12] },
        { tipo: "caixa", de: [4, 8, 3], ate: [10, 8, 11] },
        // quina arredondada
        { tipo: "caixa", de: [3, 7, 2], ate: [11, 7, 2], apagar: true },
        { tipo: "caixa", de: [3, 7, 12], ate: [11, 7, 12], apagar: true },
        { tipo: "caixa", de: [3, 7, 2], ate: [3, 7, 12], apagar: true },
        { tipo: "caixa", de: [11, 7, 2], ate: [11, 7, 12], apagar: true },
        { tipo: "pontos", pontos: [[3, 1, 2], [11, 1, 2], [3, 1, 12], [11, 1, 12]], apagar: true },
        // botões: risca no meio e rodinha
        { tipo: "caixa", de: [7, 8, 8], ate: [7, 8, 11], cor: "escuro" },
        { tipo: "caixa", de: [7, 9, 8], ate: [7, 9, 9], cor: "detalhe" },
        // fio
        { tipo: "caixa", de: [7, 3, 0], ate: [7, 3, 1], cor: "detalhe" },
        ...pes(4, 11, [
          [4, 5],
          [9, 10],
        ]),
      ],
    },
    braco("e", 2, 4),
    braco("d", 12, 4),
  ],
  encaixes: {
    topo: { pos: [7, 10, 7], normal: [0, 1, 0], parte: "corpo" },
    olhos: { pos: [7, 6, 13], normal: [0, 0, 1], parte: "corpo" },
    peito: { pos: [7, 2, 13], normal: [0, 0, 1], parte: "corpo" },
    costas: { pos: [7, 4, 2], normal: [0, 0, -1], parte: "corpo" },
    mao: { pos: [13, 3, 7], normal: [1, 0, 0], parte: "braco-d" },
  },
};

export default mouse;
