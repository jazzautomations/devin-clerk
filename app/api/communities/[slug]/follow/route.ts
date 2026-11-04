import { requireCommunity } from "@/lib/communityAuth";
import { followCommunity, unfollowCommunity } from "@/lib/follows";
import { limitOrNull } from "@/lib/ratelimit";

type Ctx = { params: Promise<{ slug: string }> };

// POST segue, DELETE deixa de seguir. Sempre a própria pessoa. Membro já
// segue: o POST de membro não grava nada e devolve 409 com o motivo.
export async function POST(req: Request, { params }: Ctx) {
  const { slug } = await params;
  const g = await requireCommunity(slug);
  if ("response" in g) return g.response;
  const limited = limitOrNull(req, "community-follow", g.member.id);
  if (limited) return limited;
  const r = await followCommunity(g.community.id, g.member.id);
  if (r === "member") {
    return Response.json({ error: "Você já está na comunidade, e quem é membro já segue." }, { status: 409 });
  }
  // removido com "impedir de voltar" (migration 046)
  if (r === "banned") {
    return Response.json({ error: "Você não pode entrar nesta comunidade." }, { status: 403 });
  }
  return Response.json({ following: true, new: r === "followed" }, { status: r === "followed" ? 201 : 200 });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const { slug } = await params;
  const g = await requireCommunity(slug);
  if ("response" in g) return g.response;
  const limited = limitOrNull(req, "community-follow", g.member.id);
  if (limited) return limited;
  const removed = await unfollowCommunity(g.community.id, g.member.id);
  return Response.json({ following: false, removed });
}
