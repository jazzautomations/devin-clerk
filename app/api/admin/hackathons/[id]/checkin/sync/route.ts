import { checkinCounts } from "@/lib/checkins";
import { parseSyncItems, SYNC_MAX_ITEMS, syncCheckins } from "@/lib/checkinPack";
import { limitOrNull } from "@/lib/ratelimit";
import { requireEditionStaff } from "@/lib/staffAuth";

// Sync em lote do check-in offline: {items: [{token | registrationId, at}]}.
// Idempotente (mandar a mesma fila de novo não duplica nada); horário vem do
// aparelho mas é limitado à janela da edição; conflito entre aparelhos fica
// com o primeiro horário. Uma resposta por item, na ordem.
const HOUR = 3_600_000;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await requireEditionStaff(id);
  if ("response" in g) return g.response;
  const limited = limitOrNull(req, "checkin-sync", g.member.id, { limit: 240, windowMs: HOUR });
  if (limited) return limited;
  const items = parseSyncItems(await req.json().catch(() => null));
  if (!items) {
    return Response.json(
      { error: `mande {items: [...]} com 1 a ${SYNC_MAX_ITEMS} check-ins` },
      { status: 400 },
    );
  }
  const results = await syncCheckins(g.hackathon, items, g.member.id);
  return Response.json({ results, counts: await checkinCounts(id) });
}
