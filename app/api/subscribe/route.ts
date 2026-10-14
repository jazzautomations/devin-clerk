import { limitOrNull } from "@/lib/ratelimit";
import { subscribe } from "@/lib/subscribers";

// Newsletter da landing. Pública, então tem limite por IP (5/h) e honeypot.
// O consentimento fica gravado (data + versão da política) e a newsletter
// só sai pra quem confirmar pelo link do e-mail (lib/subscribers).
export async function POST(req: Request) {
  const limited = limitOrNull(req, "subscribe");
  if (limited) return limited;
  const body = await req.json().catch(() => null);
  const website = typeof body?.website === "string" ? body.website : "";
  if (website) {
    return Response.json({ ok: true, confirm: "pending" });
  }
  const r = await subscribe(body?.email);
  if (!r.ok) return Response.json({ error: r.error }, { status: 400 });
  return Response.json(r);
}
