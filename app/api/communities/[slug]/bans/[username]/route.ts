import { ModerationError, unbanCommunityMember } from "@/lib/communityModeration";
import { requireCommunityManager } from "@/lib/communityAuth";
import { getMemberByUsername } from "@/lib/members";
import { limitOrNull } from "@/lib/ratelimit";

type Ctx = { params: Promise<{ slug: string; username: string }> };

// Libera a volta de quem foi removido com "impedir de voltar" (migration 046).
// Sem o ban, a pessoa volta a poder entrar e seguir por conta própria.
export async function DELETE(req: Request, { params }: Ctx) {
  const { slug, username } = await params;
  const g = await requireCommunityManager(slug);
  if ("response" in g) return g.response;
  const limited = limitOrNull(req, "community-moderation", g.member.id);
  if (limited) return limited;
  const target = await getMemberByUsername(username);
  if (!target) return Response.json({ error: "Pessoa não encontrada." }, { status: 404 });
  try {
    await unbanCommunityMember(g.community, g.member, target.id);
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof ModerationError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
