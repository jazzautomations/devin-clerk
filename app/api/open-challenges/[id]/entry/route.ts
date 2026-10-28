import {
  challengeErrorResponse,
  DEADLINE_PASSED,
  ENTRY_RATE_LIMIT,
  parseEntryInput,
  requireOpenChallenge,
  submitEntry,
  withdrawEntry,
} from "@/lib/openChallenges";
import { limitOrNull } from "@/lib/ratelimit";

type Ctx = { params: Promise<{ id: string }> };

// A entrega da própria pessoa: POST cria ou atualiza até o prazo, DELETE tira.

export async function POST(req: Request, { params }: Ctx) {
  const g = await requireOpenChallenge((await params).id);
  if ("response" in g) return g.response;
  const limited = limitOrNull(req, "open-challenge-entries", g.member.id, ENTRY_RATE_LIMIT);
  if (limited) return limited;
  // prazo vencido responde o prazo, não o formulário
  if (g.challenge.phase === "encerrado" || g.challenge.phase === "resultado") {
    return Response.json({ error: DEADLINE_PASSED }, { status: 400 });
  }
  const parsed = parseEntryInput(await req.json().catch(() => null));
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });
  try {
    const entry = await submitEntry(g.challenge, g.member, parsed.value);
    return Response.json({ entry }, { status: 201 });
  } catch (e) {
    return challengeErrorResponse(e);
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  const g = await requireOpenChallenge((await params).id);
  if ("response" in g) return g.response;
  const limited = limitOrNull(req, "open-challenge-entries", g.member.id, ENTRY_RATE_LIMIT);
  if (limited) return limited;
  try {
    const removed = await withdrawEntry(g.challenge, g.member.id);
    if (!removed) return Response.json({ error: "Você não tem entrega neste desafio." }, { status: 404 });
    return Response.json({ ok: true });
  } catch (e) {
    return challengeErrorResponse(e);
  }
}
