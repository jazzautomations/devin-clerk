import { COMMUNITY_LIMITS, reportCommunity } from "@/lib/communities";
import { requireCommunity } from "@/lib/communityAuth";
import { limitOrNull } from "@/lib/ratelimit";

type Ctx = { params: Promise<{ slug: string }> };

// "denunciar": cai na fila do admin global (/admin#comunidades)
export async function POST(req: Request, { params }: Ctx) {
  const { slug } = await params;
  const g = await requireCommunity(slug);
  if ("response" in g) return g.response;
  const limited = limitOrNull(req, "community-report", g.member.id);
  if (limited) return limited;
  const b = (await req.json().catch(() => null)) as { reason?: unknown } | null;
  const reason = typeof b?.reason === "string" ? b.reason.trim() : "";
  if (reason.length < 5) return Response.json({ error: "Conte em poucas palavras o que está errado." }, { status: 400 });
  if (reason.length > COMMUNITY_LIMITS.report) {
    return Response.json({ error: `Até ${COMMUNITY_LIMITS.report} caracteres.` }, { status: 400 });
  }
  await reportCommunity(g.community.id, g.member.id, reason);
  return Response.json({ ok: true }, { status: 201 });
}
