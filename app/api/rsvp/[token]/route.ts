import { respondRsvp, type RsvpAction } from "@/lib/rsvp";

// Resposta do link do RSVP — sem login: o token assinado É a autorização.
// Aceita JSON ({"action":"confirm"|"decline"}) ou o <form> da página
// /rsvp/[token] (funciona sem JavaScript: responde 303 de volta pra página).
// GET não muda nada de propósito: leitor de e-mail que pré-carrega link
// não pode confirmar nem recusar por ninguém.
const ERROR_STATUS = {
  invalid: 404,
  not_found: 404,
  expired: 410,
  released: 409,
  closed: 409,
  not_invited: 409,
} as const;

export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const isForm = (req.headers.get("content-type") ?? "").includes("application/x-www-form-urlencoded");
  let action: unknown;
  if (isForm) {
    action = (await req.formData().catch(() => null))?.get("action");
  } else {
    action = ((await req.json().catch(() => null)) as { action?: unknown } | null)?.action;
  }
  if (action !== "confirm" && action !== "decline") {
    return Response.json({ error: "action deve ser confirm ou decline" }, { status: 400 });
  }
  const res = await respondRsvp(token, action as RsvpAction);
  if (isForm) {
    const q = res.ok ? `feito=${res.status}` : `erro=${res.reason}`;
    return new Response(null, {
      status: 303,
      headers: { Location: `/rsvp/${encodeURIComponent(token)}?${q}` },
    });
  }
  if (!res.ok) return Response.json({ error: res.reason }, { status: ERROR_STATUS[res.reason] });
  return Response.json(res);
}
