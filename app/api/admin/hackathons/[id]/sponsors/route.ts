import { requireEditionManager } from "@/lib/editionAuth";
import { addEditionSponsor, listEditionSponsors, SponsorError } from "@/lib/editionSponsors";

// Patrocinadores da edição (roadmap 037 #8) — só organizador / admin global.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await requireEditionManager(id);
  if ("response" in g) return g.response;
  return Response.json({ sponsors: await listEditionSponsors(id) });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await requireEditionManager(id);
  if ("response" in g) return g.response;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "corpo JSON inválido" }, { status: 400 });
  }
  try {
    const sponsor = await addEditionSponsor(id, body as Record<string, unknown>, g.member.id);
    return Response.json({ sponsor }, { status: 201 });
  } catch (e) {
    const status = e instanceof SponsorError ? e.status : 400;
    return Response.json({ error: (e as Error).message }, { status });
  }
}
