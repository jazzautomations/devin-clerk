import { ModerationError, removeCommunityMember } from "@/lib/communityModeration";
import { requireCommunityManager } from "@/lib/communityAuth";
import { getMemberByUsername } from "@/lib/members";
import { limitOrNull } from "@/lib/ratelimit";

type Ctx = { params: Promise<{ slug: string; username: string }> };

// Remove membro da comunidade (migration 046). Dono e organizador podem;
// organizador não remove organizador e ninguém remove o dono (403). Corpo
// opcional { ban: true, reason } grava "impedir de voltar": a pessoa não
// entra nem segue de novo (403 nas rotas de entrar e seguir).
export async function DELETE(req: Request, { params }: Ctx) {
  const { slug, username } = await params;
  const g = await requireCommunityManager(slug);
  if ("response" in g) return g.response;
  const limited = limitOrNull(req, "community-moderation", g.member.id);
  if (limited) return limited;
  const target = await getMemberByUsername(username);
  if (!target) return Response.json({ error: "Pessoa não encontrada." }, { status: 404 });
  const b = (await req.json().catch(() => null)) as { ban?: unknown; reason?: unknown } | null;
  try {
    const r = await removeCommunityMember({
      community: g.community,
      actor: g.member,
      targetId: target.id,
      ban: b?.ban === true,
      reason: typeof b?.reason === "string" ? b.reason : null,
    });
    return Response.json({ ok: true, banned: r.banned });
  } catch (e) {
    if (e instanceof ModerationError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
