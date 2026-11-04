import { auth } from "@clerk/nextjs/server";
import { EncounterError, encounterGate, respondEncounter, setEncounterSide } from "@/lib/encounters";
import { getMemberByClerkId } from "@/lib/members";
import { limitOrNull } from "@/lib/ratelimit";

// PATCH — um encontro meu na edição:
//   { action: "confirm" | "decline" }            responde o pedido pendente
//   { depth?, cardKey?, note?, hide? }           "como foi a conversa"
//
// Confirmar avisa quem pediu; recusar NÃO avisa (quem pediu só vê "não rolou
// dessa vez" na tela). Profundidade só conta quando os dois marcam "além".

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; encounterId: string }> },
) {
  const { userId } = await auth();
  const member = userId ? await getMemberByClerkId(userId) : null;
  if (!member) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id, encounterId } = await params;
  const numeric = Number(encounterId);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) {
    return Response.json({ error: "Encontro não encontrado." }, { status: 404 });
  }
  const gate = await encounterGate(member.id, id);
  if (!gate.ok) return Response.json({ error: gate.message, reason: gate.reason }, { status: 403 });
  const limited = limitOrNull(req, "encounters", member.id);
  if (limited) return limited;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "Nada pra salvar." }, { status: 400 });

  try {
    const me = { id: member.id, username: member.username };
    if (body.action === "confirm" || body.action === "decline") {
      const encounter = await respondEncounter(me, numeric, body.action);
      return Response.json({ encounter });
    }
    const encounter = await setEncounterSide(me, numeric, {
      depth: body.depth,
      cardKey: body.cardKey,
      note: body.note,
      hide: body.hide,
    });
    return Response.json({ encounter });
  } catch (e) {
    if (e instanceof EncounterError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
