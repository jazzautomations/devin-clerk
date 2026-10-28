import type { EspecieDef } from "@/lib/mascote/tipos";
import { braco } from "@/lib/mascote/especies/comum";

// patinho de borracha, o do debug: corpo e cabeça separados, bico na frente
const patinho: EspecieDef = {
  id: "patinho",
  nome: "patinho",
  frase: "Escuta o bug inteiro sem interromper.",
  cores: ["amarelo", "laranja"],
  partes: [
    {
      nome: "corpo",
      pivo: [7.5, 0, 7.5],
      escala: "corpo",
      primitivas: [
        { tipo: "elipsoide", centro: [7.5, 4, 7.5], raios: [4.6, 3.4, 5] },
        { tipo: "caixa", de: [6, 6, 2], ate: [8, 7, 3] },
        { tipo: "caixa", de: [0, 0, 0], ate: [15, 0, 15], apagar: true },
        {
          tipo: "pontos",
          pontos: [
            [5, 0, 8],
            [6, 0, 8],
            [9, 0, 8],
            [10, 0, 8],
          ],
          cor: "detalhe",
        },
      ],
    },
    {
      nome: "cabeca",
      pai: "corpo",
      escala: "cabeca",
      pivo: [7.5, 6.5, 8.5],
      primitivas: [
        { tipo: "esfera", centro: [7.5, 8.5, 8.5], raio: 3.6 },
        { tipo: "caixa", de: [5, 6, 11], ate: [9, 7, 12], cor: "detalhe" },
      ],
    },
    braco("e", 2, 5),
    braco("d", 12, 5),
  ],
  encaixes: {
    topo: { pos: [7, 12, 8], normal: [0, 1, 0], parte: "cabeca" },
    olhos: { pos: [7, 9, 12], normal: [0, 0, 1], parte: "cabeca" },
    peito: { pos: [7, 4, 13], normal: [0, 0, 1], parte: "corpo" },
    costas: { pos: [7, 4, 2], normal: [0, 0, -1], parte: "corpo" },
    mao: { pos: [13, 4, 7], normal: [1, 0, 0], parte: "braco-d" },
  },
  boca: [0, -2, 0],
};

export default patinho;
