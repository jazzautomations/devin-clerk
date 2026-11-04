import { auth } from "@clerk/nextjs/server";
import {
  editionOr404,
  encounterGate,
  meetState,
  readMeetCode,
  type GateReason,
  type MeetState,
} from "@/lib/encounters";
import { getMemberByClerkId } from "@/lib/members";
import { limitOrNull } from "@/lib/ratelimit";

// GET  — estado da tela de encontros (código, pedidos, confirmados,
//        contadores, missões e sugestões). O polling de 10s bate aqui.
// POST — leu um código: { code }. Código inválido, de quem pausou, de quem
//        bloqueou ou de quem já recusou 3 vezes devolve a MESMA resposta.
//
// Sem check-in ou sem aceite a leitura dá 403 com o motivo (o GET devolve o
// motivo em 200 pra tela explicar sem tela de erro).

async function gate(params: Promise<{ id: string }>) {
  const { userId } = await auth();
  const member = userId ? await getMemberByClerkId(userId) : null;
  if (!member) return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) } as const;
  const id = (await params).id;
  try {
    await editionOr404(id);
  } catch {
    return { error: Response.json({ error: "Edição não encontrada." }, { status: 404 }) } as const;
  }
  return { member, id } as const;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await gate(params);
  if (g.error) return g.error;
  const state: MeetState = await meetState({ id: g.member.id, username: g.member.username }, g.id);
  return Response.json(state);
}

const GATE_STATUS: Record<GateReason, number> = {
  edition: 404,
  off: 403,
  registration: 403,
  checkin: 403,
  age: 403,
  consent: 403,
  window: 409,
};

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await gate(params);
  if (g.error) return g.error;
  const limited = limitOrNull(req, "encounters", g.member.id);
  if (limited) return limited;
  const body = (await req.json().catch(() => null)) as { code?: unknown } | null;
  const gateState = await encounterGate(g.member.id, g.id);
  if (!gateState.ok) {
    return Response.json({ error: gateState.message, reason: gateState.reason }, { status: GATE_STATUS[gateState.reason] });
  }
  const r = await readMeetCode({ id: g.member.id, username: g.member.username }, g.id, body?.code);
  if (!r.ok) {
    const status = r.kind === "not_found" ? 404 : r.kind === "gate" ? 403 : 409;
    return Response.json({ error: r.message, kind: r.kind }, { status });
  }
  const state = await meetState({ id: g.member.id, username: g.member.username }, g.id);
  return Response.json({ ...r, state }, { status: 201 });
}
