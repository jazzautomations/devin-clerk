import db from "@/lib/db";

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const website = typeof body?.website === "string" ? body.website : "";
  if (website) {
    return Response.json({ ok: true });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return Response.json({ error: "E-mail inválido" }, { status: 400 });
  }
  db.prepare("INSERT OR IGNORE INTO subscribers (email) VALUES (?)").run(
    email.toLowerCase(),
  );
  return Response.json({ ok: true });
}
