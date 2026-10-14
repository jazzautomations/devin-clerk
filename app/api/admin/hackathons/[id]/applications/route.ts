import { requireEditionManager } from "@/lib/editionAuth";
import { limitOrNull } from "@/lib/ratelimit";
import { getOpenKinds, isApplicationKind, listApplications, setKindOpen } from "@/lib/roleApplications";

// frente E (spec 033) — candidaturas da edição (organizador): GET lista
// (?kind= filtra) + tipos abertos; PUT { kind, open } abre/fecha um tipo.

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await requireEditionManager(id);
  if ("response" in g) return g.response;
  const kind = new URL(req.url).searchParams.get("kind");
  if (kind !== null && !isApplicationKind(kind)) {
    return Response.json({ error: "tipo inválido" }, { status: 400 });
  }
  const [applications, open] = await Promise.all([
    listApplications(id, kind ?? undefined),
    getOpenKinds(id),
  ]);
  return Response.json({ applications, open });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await requireEditionManager(id);
  if ("response" in g) return g.response;
  const limited = limitOrNull(req, "application-review", g.member.id);
  if (limited) return limited;
  const b = (await req.json().catch(() => null)) as { kind?: unknown; open?: unknown } | null;
  if (!isApplicationKind(b?.kind) || typeof b?.open !== "boolean") {
    return Response.json({ error: "corpo deve ser { kind: voluntario|mentor|jurado, open: boolean }" }, { status: 400 });
  }
  return Response.json({ open: await setKindOpen(id, b.kind, b.open, g.member.id) });
}
