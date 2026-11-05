import { requireCommunityManager } from "@/lib/communityAuth";
import { SpaceError, updateSpace } from "@/lib/communitySpaces";
import { limitOrNull } from "@/lib/ratelimit";

// Um espaço (migration 057): PATCH renomeia, muda descrição/política e
// arquiva/desarquiva ({ name?, description?, postPolicy?, archived? }).
// Arquivar esconde do seletor e mantém os posts. Dono, organizador ou admin.

type Ctx = { params: Promise<{ slug: string; spaceId: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const { slug, spaceId } = await params;
  const g = await requireCommunityManager(slug);
  if ("response" in g) return g.response;
  const limited = limitOrNull(req, "community-spaces", g.member.id);
  if (limited) return limited;
  const id = Number(spaceId);
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: "Espaço não encontrado." }, { status: 404 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return Response.json({ error: "body inválido" }, { status: 400 });
  try {
    const space = await updateSpace(g.community.id, id, body as Record<string, unknown>);
    return Response.json({ space });
  } catch (e) {
    if (e instanceof SpaceError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
