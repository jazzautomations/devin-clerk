// Paleta do bicho (migration 043). 12 cores que funcionam sobre o papel
// #fefefe e perto da tinta #0c0c0c: nada tão claro que suma no papel sem
// sombra, nada tão escuro que o olho de tinta desapareça (o olho troca pra
// papel sozinho quando a cor de baixo é escura, ver corDoOlho).

export const PALETA = [
  { id: "banda", nome: "verde-banda", hex: "#3ecf8e" },
  { id: "verde", nome: "verde", hex: "#1f9d61" },
  { id: "amarelo", nome: "amarelo", hex: "#ffd23f" },
  { id: "laranja", nome: "laranja", hex: "#ff8a3d" },
  { id: "tijolo", nome: "tijolo", hex: "#d2502c" },
  { id: "rosa", nome: "rosa", hex: "#ff8fb1" },
  { id: "lilas", nome: "lilás", hex: "#a98bff" },
  { id: "azul", nome: "azul", hex: "#3f8cff" },
  { id: "ceu", nome: "céu", hex: "#8fd6ff" },
  { id: "marrom", nome: "marrom", hex: "#9a6b45" },
  { id: "papel", nome: "papel", hex: "#efece4" },
  { id: "tinta", nome: "grafite", hex: "#34363a" },
] as const;

export type CorId = (typeof PALETA)[number]["id"];

export const COR_IDS: readonly CorId[] = PALETA.map((c) => c.id);

export const TINTA = "#0c0c0c";
export const PAPEL = "#fefefe";

const BY_ID = new Map<string, string>(PALETA.map((c) => [c.id, c.hex]));

export function corHex(id: string): string {
  return BY_ID.get(id) ?? PALETA[0].hex;
}

function parse(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function toHex([r, g, b]: [number, number, number]): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** multiplica o brilho (sombra da face: 1, 0.82, 0.66) */
export function sombrear(hex: string, fator: number): string {
  if (fator === 1) return hex.toLowerCase();
  const [r, g, b] = parse(hex);
  return toHex([r * fator, g * fator, b * fator]);
}

/** mistura com branco (t = 0..1) */
export function clarear(hex: string, t: number): string {
  const [r, g, b] = parse(hex);
  return toHex([r + (255 - r) * t, g + (255 - g) * t, b + (255 - b) * t]);
}

/** luminância relativa aproximada (0..1) */
export function luminancia(hex: string): number {
  const [r, g, b] = parse(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** olho pintado: tinta em cor clara, papel em cor escura */
export function corDoOlho(fundo: string): string {
  return luminancia(fundo) < 0.12 ? PAPEL : TINTA;
}
