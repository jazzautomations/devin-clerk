import { ModerationError, transferCommunity } from "@/lib/communityModeration";
import { requireCommunityOwner } from "@/lib/communityAuth";
import { getMemberByUsername } from "@/lib/members";
import { limitOrNull } from "@/lib/ratelimit";

type Ctx = { params: Promise<{ slug: string }> };

// Passa a posse da comunidade pra um organizador (migration 046). Só o dono
// (ou o admin global). Quem recebe vira dono; quem passa fica organizador,
// então a comunidade nunca fica sem ninguém.
export async function POST(req: Request, { params }: Ctx) {
  const { slug } = await params;
  const g = await requireCommunityOwner(slug);
  if ("response" in g) return g.response;
  const limited = limitOrNull(req, "community-moderation", g.member.id);
  if (limited) return limited;
  const b = (await req.json().catch(() => null)) as { username?: unknown } | null;
  if (typeof b?.username !== "string" || !b.username.trim()) {
    return Response.json({ error: "Escolha quem recebe a comunidade." }, { status: 400 });
  }
  const target = await getMemberByUsername(b.username.trim().replace(/^@/, ""));
  if (!target) return Response.json({ error: "Pessoa não encontrada." }, { status: 404 });
  try {
    await transferCommunity(g.community, g.member, target.id);
    return Response.json({ ok: true, owner: target.username });
  } catch (e) {
    if (e instanceof ModerationError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
