// id numérico vindo de URL: só dígitos, sem zero à esquerda, cabendo num
// INTEGER do Postgres. Number.isInteger aceitava "1e21" e 2147483648, que
// viravam 500 no banco ("invalid input syntax for type integer").
const INT4_MAX = 2_147_483_647;

export function parseId(raw: string | null | undefined): number | null {
  if (typeof raw !== "string" || !/^[1-9]\d{0,9}$/.test(raw)) return null;
  const n = Number(raw);
  return n <= INT4_MAX ? n : null;
}
