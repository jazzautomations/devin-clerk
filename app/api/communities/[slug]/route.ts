import { getMembership, parseCommunityInput, updateCommunity } from "@/lib/communities";
import { requireCommunity, requireCommunityManager, requireCommunityOwner } from "@/lib/communityAuth";
import { softDeleteCommunity } from "@/lib/communityModeration";
import { limitOrNull } from "@/lib/ratelimit";

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

// DELETE: exclui a comunidade (migration 046). Só o dono, e só com o
// endereço digitado ({ confirm: "<slug>" }). É soft: deletedAt e hidden,
// então some das listas e a página dá 404; hackathons mantêm o communityId.
export async function DELETE(req: Request, { params }: Ctx) {
  const { slug } = await params;
  const g = await requireCommunityOwner(slug);
  if ("response" in g) return g.response;
  const limited = limitOrNull(req, "community-moderation", g.member.id);
  if (limited) return limited;
  const b = (await req.json().catch(() => null)) as { confirm?: unknown } | null;
  if (typeof b?.confirm !== "string" || b.confirm.trim() !== g.community.slug) {
    return Response.json({ error: "Digite o endereço da comunidade pra confirmar." }, { status: 400 });
  }
  await softDeleteCommunity(g.community, g.member);
  return Response.json({ ok: true });
}
