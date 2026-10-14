// Telefone BR → E.164 sem "+" (formato que a Evolution espera).
// Aceita com ou sem 55, com máscara; DDD com dois dígitos 1–9; celular
// 9 + 8 dígitos ou fixo de 8 dígitos começando em 2–5. Resto é null.
export function normalizeBrPhone(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let digits = input.replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  return /^55[1-9]{2}(9\d{8}|[2-5]\d{7})$/.test(digits) ? digits : null;
}

/** 5511999999999 → +55 (11) 99999-9999 — só pra exibir */
export function formatBrPhone(e164: string): string {
  const m = e164.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `+55 (${m[1]}) ${m[2]}-${m[3]}` : e164;
}
