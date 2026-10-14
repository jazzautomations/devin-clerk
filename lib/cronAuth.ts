import { createHash, timingSafeEqual } from "node:crypto";

// Authorization: Bearer $HACKAHUB_CRON_SECRET — sem a env configurada,
// nunca autoriza. Compara hashes de tamanho fixo (timingSafeEqual exige
// mesmo comprimento).
const digest = (s: string) => createHash("sha256").update(s).digest();

export function cronAuthorized(req: Request): boolean {
  const secret = process.env.HACKAHUB_CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  return token.length > 0 && timingSafeEqual(digest(token), digest(secret));
}
