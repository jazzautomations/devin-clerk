import { limitOrNull } from "@/lib/ratelimit";
import { currentMember } from "@/lib/session";
import { mascoteDoMembro, salvarMascote } from "@/lib/mascote/store";
import { validarMascote } from "@/lib/mascote/validar";

// Bicho de quem está logado (migration 043). GET devolve o salvo ou o da
// semente; PUT valida e grava. Erro de validação: 400 com a mensagem do
// primeiro campo em `error` e todas em `campos`.

const unauthorized = () => Response.json({ error: "Unauthorized" }, { status: 401 });

export async function GET() {
  const me = await currentMember();
  if (!me) return unauthorized();
  return Response.json(await mascoteDoMembro(me.id));
}

export async function PUT(req: Request) {
  const me = await currentMember();
  if (!me) return unauthorized();
  const limited = limitOrNull(req, "mascote", me.id);
  if (limited) return limited;
  const body = await req.json().catch(() => null);
  const r = validarMascote(body && typeof body === "object" && "config" in body ? body.config : body);
  if (!r.ok) return Response.json({ error: r.erro, campos: r.erros }, { status: 400 });
  const { hash, src } = await salvarMascote(me.id, r.config);
  return Response.json({ ok: true, config: r.config, salvo: true, hash, src });
}
