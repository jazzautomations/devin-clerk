import { CommunityError, joinCommunity, leaveCommunity } from "@/lib/communities";
import { requireCommunity } from "@/lib/communityAuth";
import { limitOrNull } from "@/lib/ratelimit";

type Ctx = { params: Promise<{ slug: string }> };

// POST entra, DELETE sai. Sempre a própria pessoa: não há como pôr ou tirar
// outro membro por aqui (organizador é por /organizers, remover é por
// /members/[username]). Quem foi removido com ban não entra (403, migration 046).
export async function POST(req: Request, { params }: Ctx) {
  const { slug } = await params;
  const g = await requireCommunity(slug);
  if ("response" in g) return g.response;
  const limited = limitOrNull(req, "community-join", g.member.id);
  if (limited) return limited;
  try {
    const joined = await joinCommunity(g.community, g.member);
    return Response.json({ joined: true, new: joined }, { status: joined ? 201 : 200 });
  } catch (e) {
    if (e instanceof CommunityError && e.code === "banned") {
      return Response.json({ error: e.message }, { status: 403 });
    }
    throw e;
  }
}

export async function DELETE(req: Request, { params }: Ctx) {
  const { slug } = await params;
  const g = await requireCommunity(slug);
  if ("response" in g) return g.response;
  const limited = limitOrNull(req, "community-join", g.member.id);
  if (limited) return limited;
  try {
    const left = await leaveCommunity(g.community.id, g.member.id);
    return Response.json({ left });
  } catch (e) {
    if (e instanceof CommunityError && e.code === "last_owner") {
      return Response.json({ error: e.message }, { status: 409 });
    }
    throw e;
  }
}
