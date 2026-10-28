import type { EspecieDef } from "@/lib/mascote/tipos";
import { braco } from "@/lib/mascote/especies/comum";

// xícara de café com alça do lado esquerdo e café até a borda
const cafe: EspecieDef = {
  id: "cafe",
  nome: "café",
  frase: "Mantém o time acordado até o pitch.",
  cores: ["papel", "marrom"],
  partes: [
    {
      nome: "corpo",
      pivo: [7.5, 0, 7.5],
      escala: "corpo",
      primitivas: [
        { tipo: "cilindro", centro: [7.5, 1, 7.5], raio: 4.6, altura: 9, eixo: "y" },
        { tipo: "cilindro", centro: [7.5, 8, 7.5], raio: 3.6, altura: 2, eixo: "y", apagar: true },
        { tipo: "cilindro", centro: [7.5, 8, 7.5], raio: 3.6, altura: 1, eixo: "y", cor: "#5a3420" },
        { tipo: "cilindro", centro: [7.5, 2, 7.5], raio: 4.6, altura: 1, eixo: "y", cor: "detalhe" },
        {
          tipo: "pontos",
          pontos: [
            [2, 7, 7],
            [1, 7, 7],
            [1, 6, 7],
            [1, 5, 7],
            [1, 4, 7],
            [2, 4, 7],
          ],
          cor: "detalhe",
        },
        { tipo: "cilindro", centro: [7.5, 0, 7.5], raio: 3.2, altura: 1, eixo: "y", cor: "escuro" },
      ],
    },
    braco("d", 12, 6),
  ],
  encaixes: {
    topo: { pos: [7, 10, 7], normal: [0, 1, 0], parte: "corpo" },
    olhos: { pos: [7, 7, 12], normal: [0, 0, 1], parte: "corpo" },
    peito: { pos: [7, 3, 12], normal: [0, 0, 1], parte: "corpo" },
    costas: { pos: [7, 5, 2], normal: [0, 0, -1], parte: "corpo" },
    mao: { pos: [13, 5, 7], normal: [1, 0, 0], parte: "braco-d" },
  },
};

export default cafe;
