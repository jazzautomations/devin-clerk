import { requireCommunityManager } from "@/lib/communityAuth";
import { createCommunityHackathon, parseNewHackathon } from "@/lib/communityHackathons";
import { limitOrNull } from "@/lib/ratelimit";

// POST: dono/organizador da comunidade (ou admin global) abre um hackathon
// nela. Nasce rascunho; quem cria vira organizador da edição. 5 por dia.
export async function POST(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const g = await requireCommunityManager(slug);
  if ("response" in g) return g.response;
  const limited = limitOrNull(req, "community-hackathons", g.member.id);
  if (limited) return limited;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return Response.json({ error: "corpo da requisição inválido" }, { status: 400 });
  const parsed = parseNewHackathon(b);
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });
  const { id } = await createCommunityHackathon(g.community, g.member.id, parsed.value);
  return Response.json({ id, panel: `/admin/h/${id}` }, { status: 201 });
}
