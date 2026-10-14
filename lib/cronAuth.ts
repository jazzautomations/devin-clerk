import { createHash, timingSafeEqual } from "node:crypto";

// Authorization: Bearer $HACKAHUB_CRON_SECRET — mesma regra do cron de
// entregas (app/api/cron/deliveries): sem a env configurada, sempre nega.
const digest = (s: string) => createHash("sha256").update(s).digest();

export function isCronAuthorized(req: Request): boolean {
  const secret = process.env.HACKAHUB_CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  // hashes de tamanho fixo: timingSafeEqual exige mesmo comprimento
  return token.length > 0 && timingSafeEqual(digest(token), digest(secret));
}
