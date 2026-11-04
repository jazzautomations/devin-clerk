import { auth } from "@clerk/nextjs/server";
import { SYNC_MAX_ITEMS, editionOr404, encounterGate, meetState, syncReads } from "@/lib/encounters";
import { getMemberByClerkId } from "@/lib/members";
import { limitOrNull } from "@/lib/ratelimit";

// POST — sobe a fila de leituras feitas sem rede (padrão offlineCheckin).
// O servidor revalida cada código: o aparelho não decide nada e o horário
// fica preso à janela do evento. Uma resposta por item, na mesma ordem.

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
  const gate = await encounterGate(member.id, id);
  if (!gate.ok) return Response.json({ error: gate.message, reason: gate.reason }, { status: 403 });
  const limited = limitOrNull(req, "encounters", member.id);
  if (limited) return limited;
  const body = (await req.json().catch(() => null)) as { items?: unknown } | null;
  const items = Array.isArray(body?.items) ? body.items : null;
  if (!items || items.length === 0 || items.length > SYNC_MAX_ITEMS) {
    return Response.json({ error: `Mande de 1 a ${SYNC_MAX_ITEMS} leituras.` }, { status: 400 });
  }
  const parsed = items.map((i) => ({ code: String((i as { code?: unknown })?.code ?? "") }));
  const results = await syncReads({ id: member.id, username: member.username }, id, parsed);
  const state = await meetState({ id: member.id, username: member.username }, id);
  return Response.json({ results, state });
}
