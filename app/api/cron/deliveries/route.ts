import { createHash, timingSafeEqual } from "node:crypto";
import { processDeliveries } from "@/lib/announcements";

// spec 033 US2 — cron reprocessa a fila de entregas (falha transitória com
// backoff, até 3 tentativas). Protegido por Authorization: Bearer
// $HACKAHUB_CRON_SECRET; sem a env configurada, sempre 401.

const digest = (s: string) => createHash("sha256").update(s).digest();

function authorized(req: Request): boolean {
  const secret = process.env.HACKAHUB_CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  // compara hashes de tamanho fixo: timingSafeEqual exige mesmo comprimento
  return token.length > 0 && timingSafeEqual(digest(token), digest(secret));
}

export async function POST(req: Request) {
  if (!authorized(req)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json(await processDeliveries(200));
}
