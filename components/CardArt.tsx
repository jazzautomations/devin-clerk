// arte gerativa determinística da cartinha — hash do id da edição
// define paleta e padrão. CSS puro, sem assets.

function hashSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function CardArt({ seed, className = "" }: { seed: string; className?: string }) {
  const h = hashSeed(seed);
  const hue1 = h % 360;
  const hue2 = (hue1 + 60 + (h % 90)) % 360;
  const c1 = `hsl(${hue1} 75% 52%)`;
  const c2 = `hsl(${hue2} 65% 22%)`;
  const bg = `hsl(${hue2} 45% 9%)`;
  const pattern = h % 5;

  const backgrounds = [
    // listras diagonais
    `repeating-linear-gradient(135deg, ${c1} 0 10px, ${c2} 10px 20px, ${bg} 20px 34px)`,
    // pontos em grade
    `radial-gradient(circle at center, ${c1} 2.5px, transparent 3px) 0 0 / 22px 22px, linear-gradient(160deg, ${c2}, ${bg})`,
    // anéis concêntricos
    `repeating-radial-gradient(circle at 72% 28%, ${c1} 0 6px, ${c2} 6px 18px, ${bg} 18px 30px)`,
    // xadrez
    `conic-gradient(from 90deg at 50% 50%, ${c1} 0 25%, ${c2} 0 50%, ${bg} 0 75%, ${c2} 0) 0 0 / 36px 36px`,
    // trama cruzada
    `repeating-linear-gradient(45deg, ${c1} 0 4px, transparent 4px 16px), repeating-linear-gradient(-45deg, ${c2} 0 4px, ${bg} 4px 16px)`,
  ];

  return (
    <div
      className={`scanlines relative ${className}`}
      style={{ background: backgrounds[pattern] }}
      aria-hidden
    />
  );
}
