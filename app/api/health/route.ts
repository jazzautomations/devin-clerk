import db from "@/lib/db";
import { deepHealth, readVersion } from "@/lib/health";

// health check do deploy e do monitor externo: app de pé + banco respondendo.
// version diz qual release está no ar; ?deep=1 soma idade do backup e do
// restore drill, fila de avisos parada, disco e falhas seguidas dos crons.
export async function GET(req: Request) {
  const version = readVersion();
  try {
    await db.prepare("SELECT 1 AS ok").get();
  } catch {
    return Response.json({ ok: false, version }, { status: 503 });
  }
  const deep = new URL(req.url).searchParams.get("deep") === "1";
  return Response.json(
    deep ? { ok: true, version, ...(await deepHealth()) } : { ok: true, version },
    { headers: { "cache-control": "no-store" } },
  );
}
