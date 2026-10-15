import { COMMUNITY_LIMITS, createNotice } from "@/lib/communities";
import { requireCommunityManager } from "@/lib/communityAuth";
import { limitOrNull } from "@/lib/ratelimit";

type Ctx = { params: Promise<{ slug: string }> };

// aviso da organização: dono/organizador escreve, cada membro recebe uma
// notificação no HackaHub
export async function POST(req: Request, { params }: Ctx) {
  const { slug } = await params;
  const g = await requireCommunityManager(slug);
  if ("response" in g) return g.response;
  const limited = limitOrNull(req, "community-notices", g.member.id);
  if (limited) return limited;
  const b = (await req.json().catch(() => null)) as { title?: unknown; body?: unknown } | null;
  const title = typeof b?.title === "string" ? b.title.trim() : "";
  const body = typeof b?.body === "string" ? b.body.trim() : "";
  if (!title || !body) return Response.json({ error: "Escreva o título e o aviso." }, { status: 400 });
  if (title.length > COMMUNITY_LIMITS.noticeTitle || body.length > COMMUNITY_LIMITS.notice) {
    return Response.json(
      { error: `Título até ${COMMUNITY_LIMITS.noticeTitle} caracteres e aviso até ${COMMUNITY_LIMITS.notice}.` },
      { status: 400 },
    );
  }
  const r = await createNotice(g.community, g.member.id, title, body);
  return Response.json(r, { status: 201 });
}
