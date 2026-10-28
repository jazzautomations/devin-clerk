import type { EspecieDef } from "@/lib/mascote/tipos";
import { braco } from "@/lib/mascote/especies/comum";

// foguete: corpo redondo, bico e aletas na cor de detalhe, bocal embaixo
const foguete: EspecieDef = {
  id: "foguete",
  nome: "foguete",
  frase: "Faz deploy na sexta.",
  cores: ["papel", "tijolo"],
  partes: [
    {
      nome: "corpo",
      pivo: [7.5, 0, 7.5],
      escala: "corpo",
      primitivas: [
        { tipo: "cilindro", centro: [7.5, 2, 7.5], raio: 4.1, altura: 7, eixo: "y" },
        { tipo: "cilindro", centro: [7.5, 9, 7.5], raio: 3.2, altura: 1, eixo: "y", cor: "detalhe" },
        { tipo: "cilindro", centro: [7.5, 10, 7.5], raio: 2.2, altura: 1, eixo: "y", cor: "detalhe" },
        { tipo: "cilindro", centro: [7.5, 11, 7.5], raio: 1.2, altura: 1, eixo: "y", cor: "detalhe" },
        { tipo: "cilindro", centro: [7.5, 0, 7.5], raio: 2.6, altura: 2, eixo: "y", cor: "escuro" },
        { tipo: "caixa", de: [2, 1, 7], ate: [2, 4, 7], cor: "detalhe" },
        { tipo: "caixa", de: [1, 1, 7], ate: [1, 2, 7], cor: "detalhe" },
        { tipo: "caixa", de: [12, 1, 7], ate: [12, 4, 7], cor: "detalhe" },
        { tipo: "caixa", de: [13, 1, 7], ate: [13, 2, 7], cor: "detalhe" },
        { tipo: "caixa", de: [7, 1, 2], ate: [7, 4, 2], cor: "detalhe" },
        { tipo: "caixa", de: [7, 1, 1], ate: [7, 2, 1], cor: "detalhe" },
      ],
    },
    braco("e", 2, 7),
    braco("d", 12, 7),
  ],
  encaixes: {
    topo: { pos: [7, 12, 7], normal: [0, 1, 0], parte: "corpo" },
    olhos: { pos: [7, 7, 12], normal: [0, 0, 1], parte: "corpo" },
    peito: { pos: [7, 3, 12], normal: [0, 0, 1], parte: "corpo" },
    costas: { pos: [7, 5, 3], normal: [0, 0, -1], parte: "corpo" },
    mao: { pos: [13, 6, 7], normal: [1, 0, 0], parte: "braco-d" },
  },
};

export default foguete;
