// spec 023 — busca server-side (?q=) nas listas públicas.
// Termo cru do usuário → padrão LIKE `%…%` com curingas escapados:
// `%` e `_` do usuário são literais, nunca coringas (ESCAPE '\' no SQL).
export function toLikePattern(q: string | null | undefined): string | null {
  const t = (q ?? "").trim();
  if (!t) return null;
  return `%${t.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
