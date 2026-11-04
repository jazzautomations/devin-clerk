import { limitOrNull } from "@/lib/ratelimit";
import { setMascoteItens } from "@/lib/members";
import { currentMember } from "@/lib/session";
import { regravarAvatar, unlockedItems } from "@/lib/mascote/evolucao";
import { ITENS, normalizarItens, type ItemId } from "@/lib/mascote/itens";
import { mascoteDoMembro, salvarMascote } from "@/lib/mascote/store";
import { validarMascote } from "@/lib/mascote/validar";

// Bicho de quem está logado (migration 043; itens e avatar na 047). GET
// devolve o salvo ou o da semente; PUT valida e grava config e itens.
// Erro de validação: 400 com a mensagem do primeiro campo em `error` e todas
// em `campos`.
//
// Item só entra se o FATO destravou (lib/evidence.ts, via unlockedItems):
// escolher no editor não destrava nada. Salvar regrava o avatarUrl de quem
// usa o bicho como avatar, então a lista seguinte já mostra o bicho novo.

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
  const embrulhado = !!body && typeof body === "object" && "config" in body;
  const r = validarMascote(embrulhado ? (body as { config: unknown }).config : body);
  if (!r.ok) return Response.json({ error: r.erro, campos: r.erros }, { status: 400 });

  // itens: campo ausente preserva a escolha; lista vazia volta pros mais
  // recentes. Item que o fato ainda não destravou é 400 — nunca por escolha.
  let itens: ItemId[] | undefined;
  if (embrulhado && "itens" in (body as Record<string, unknown>)) {
    const pedidos = normalizarItens((body as { itens: unknown }).itens);
    const destravados = await unlockedItems(me.id);
    const travado = pedidos.find((id) => !destravados.includes(id));
    if (travado) {
      const erro = `${ITENS[travado].nome}: ${ITENS[travado].destrava}`;
      return Response.json({ error: erro, campos: { itens: erro } }, { status: 400 });
    }
    itens = pedidos;
  }

  const { hash, src } = await salvarMascote(me.id, r.config);
  if (itens) await setMascoteItens(me.id, itens);
  const avatar = await regravarAvatar(me.id);
  return Response.json({
    ok: true,
    config: r.config,
    salvo: true,
    hash,
    src,
    itens: itens ?? null,
    avatarKind: avatar.avatarKind,
    avatarUrl: avatar.avatarUrl,
  });
}
