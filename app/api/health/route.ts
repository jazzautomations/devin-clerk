import db from "@/lib/db";

// health check do deploy e do monitor externo: app de pé + banco respondendo
export async function GET() {
  try {
    await db.prepare("SELECT 1 AS ok").get();
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
