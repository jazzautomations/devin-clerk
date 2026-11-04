import { auth } from "@clerk/nextjs/server";
import {
  EncounterError,
  editionOr404,
  encounterGate,
  myMeet,
  optInEncounters,
  pauseEncounters,
  revokeEncounters,
  rotateMeetCode,
} from "@/lib/encounters";
import { getMemberByClerkId } from "@/lib/members";
import { limitOrNull } from "@/lib/ratelimit";

// POST — meu código e meus aceites na edição. Um corpo, uma ação:
//   { enabled: true, channel?, newcomerOptIn?, introOptIn? }  aceite/atualização
//   { paused: true|false }                                    pausar/voltar
//   { rotate: true }                                          código novo
//   { revoke: true }                                          revogar o aceite
//
// São três aceites separados e revogáveis: encontros na edição, "pode me
// mostrar como estreante" e intros quinzenais. Nenhum vem marcado.

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  const member = userId ? await getMemberByClerkId(userId) : null;
  if (!member) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const id = (await params).id;
  try {
    await editionOr404(id);
  } catch {
    return Response.json({ error: "Edição não encontrada." }, { status: 404 });
  }
  const limited = limitOrNull(req, "encounters", member.id);
  if (limited) return limited;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "Nada pra salvar." }, { status: 400 });

  try {
    if (body.revoke === true) {
      await revokeEncounters(member.id, id);
      return Response.json({ me: null });
    }
    const gate = await encounterGate(member.id, id);
    // sem aceite ainda: é justamente o que este POST cria
    if (!gate.ok && gate.reason !== "consent") {
      return Response.json({ error: gate.message, reason: gate.reason }, { status: 403 });
    }
    if (body.rotate === true) {
      const me = await myMeet(member.id, id);
      if (!me) return Response.json({ error: "Ative os encontros primeiro." }, { status: 403 });
      return Response.json({ me: await rotateMeetCode(member.id, id) });
    }
    if (body.paused !== undefined) {
      return Response.json({ me: await pauseEncounters(member.id, id, body.paused === true) });
    }
    if (body.enabled !== true) {
      return Response.json({ error: "Diga o que você quer mudar." }, { status: 400 });
    }
    const me = await optInEncounters(member.id, id, {
      channel: body.channel,
      newcomerOptIn: body.newcomerOptIn,
      introOptIn: body.introOptIn,
    });
    return Response.json({ me }, { status: 201 });
  } catch (e) {
    if (e instanceof EncounterError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
