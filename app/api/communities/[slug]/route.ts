import { getMembership, parseCommunityInput, updateCommunity } from "@/lib/communities";
import { requireCommunity, requireCommunityManager } from "@/lib/communityAuth";

type Ctx = { params: Promise<{ slug: string }> };

// GET: a comunidade e o papel de quem pergunta (logado)
export async function GET(_req: Request, { params }: Ctx) {
  const { slug } = await params;
  const g = await requireCommunity(slug);
  if ("response" in g) return g.response;
  const role = await getMembership(g.community.id, g.member.id);
  return Response.json({ community: g.community, role });
}

// PATCH: dono, organizador ou admin edita. O endereço não muda (link já
// divulgado); esconder e selo são do admin (/api/admin/communities).
export async function PATCH(req: Request, { params }: Ctx) {
  const { slug } = await params;
  const g = await requireCommunityManager(slug);
  if ("response" in g) return g.response;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return Response.json({ error: "corpo da requisição inválido" }, { status: 400 });
  if ("slug" in b || "hidden" in b || "verified" in b) {
    return Response.json({ error: "Endereço, selo e visibilidade não mudam por aqui." }, { status: 400 });
  }
  const parsed = parseCommunityInput(b, "update");
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });
  const next = { ...g.community, ...parsed.value };
  if (!next.online && !next.city) {
    return Response.json({ error: "Diga a cidade da comunidade ou marque que ela é online." }, { status: 400 });
  }
  const community = await updateCommunity(g.community.id, parsed.value);
  return Response.json({ community });
}
