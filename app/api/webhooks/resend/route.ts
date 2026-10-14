import { createHmac, timingSafeEqual } from "node:crypto";
import { markEmailBounced } from "@/lib/contact";

// Webhook do Resend (assinado no padrão Svix). email.bounced e
// email.complained marcam o contato (members.emailBouncedAt) e o worker de
// avisos para de mandar e-mail pra ele — edge case "bounce não insiste".
// Secret: RESEND_WEBHOOK_SECRET ("whsec_<base64>"); sem ela, sempre 401.

const TOLERANCE_SEC = 5 * 60;

function verify(req: Request, body: string): boolean {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return false;
  const id = req.headers.get("svix-id");
  const ts = req.headers.get("svix-timestamp");
  const sigHeader = req.headers.get("svix-signature");
  if (!id || !ts || !sigHeader) return false;
  const age = Math.abs(Date.now() / 1000 - Number(ts));
  if (!Number.isFinite(age) || age > TOLERANCE_SEC) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest();
  return sigHeader.split(" ").some((part) => {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) return false;
    const got = Buffer.from(sig, "base64");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

export async function POST(req: Request) {
  const body = await req.text();
  if (!verify(req, body)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  let evt: { type?: string; data?: { to?: unknown } };
  try {
    evt = JSON.parse(body);
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  if (evt.type !== "email.bounced" && evt.type !== "email.complained") {
    return Response.json({ ok: true, ignored: true });
  }
  const to = Array.isArray(evt.data?.to) ? evt.data.to : [evt.data?.to];
  let marked = 0;
  for (const email of to) {
    if (typeof email === "string") marked += await markEmailBounced(email);
  }
  return Response.json({ ok: true, marked });
}
