import { requireEditionManager } from "@/lib/editionAuth";
import { publishSchedule } from "@/lib/schedule";

// Publica rascunhos da programação: todos, ou {ids: [...]}.

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await requireEditionManager(id);
  if ("response" in g) return g.response;
  const raw = (await req.json().catch(() => null)) as { ids?: unknown } | null;
  const ids = Array.isArray(raw?.ids)
    ? raw.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0)
    : undefined;
  return Response.json({ published: await publishSchedule(id, ids) });
}
