import { auth } from "@clerk/nextjs/server";
import { EncounterError, createIntroduction, encounterGate } from "@/lib/encounters";
import { getMemberByClerkId } from "@/lib/members";
import { limitOrNull } from "@/lib/ratelimit";

// POST — "apresentei X a Y" (missão ponte): { peer, recipient } (usernames).
// Conta quando X e Y confirmam encontro entre si depois da apresentação —
// quem apresentou não ganha nada na hora, só a ponte registrada.

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  const member = userId ? await getMemberByClerkId(userId) : null;
  if (!member) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const gate = await encounterGate(member.id, id);
  if (!gate.ok) return Response.json({ error: gate.message, reason: gate.reason }, { status: 403 });
  const limited = limitOrNull(req, "encounters", member.id);
  if (limited) return limited;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  try {
    const r = await createIntroduction(
      { id: member.id, username: member.username },
      id,
      body?.peer,
      body?.recipient,
    );
    return Response.json(r, { status: 201 });
  } catch (e) {
    if (e instanceof EncounterError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
