import { CommunityError, createCommunity, listCommunities, nearby, parseCommunityInput } from "@/lib/communities";
import { requireMember } from "@/lib/communityAuth";
import { limitOrNull } from "@/lib/ratelimit";

// GET  /api/communities?q=&perto=1 — lista (logado). perto=1 devolve só as da
//      cidade/estado do perfil (onboarding); city= sobrescreve a cidade.
// POST /api/communities — qualquer membro cria e vira dono. 3 por dia.
export async function GET(req: Request) {
  const g = await requireMember();
  if ("response" in g) return g.response;
  const url = new URL(req.url);
  const list = await listCommunities({ q: url.searchParams.get("q") });
  if (url.searchParams.get("perto") === "1") {
    const city = url.searchParams.get("city") ?? g.member.city ?? null;
    const near = nearby(list, city).slice(0, 6);
    return Response.json({ communities: near.map((n) => ({ ...pick(n.item), match: n.match })) });
  }
  return Response.json({ communities: list.map(pick) });
}

const pick = (c: Awaited<ReturnType<typeof listCommunities>>[number]) => ({
  slug: c.slug,
  name: c.name,
  description: c.description,
  city: c.city,
  online: c.online,
  verified: c.verified,
  members: c.members,
  upcoming: c.upcoming,
  nextName: c.nextName,
});

export async function POST(req: Request) {
  const g = await requireMember();
  if ("response" in g) return g.response;
  const limited = limitOrNull(req, "communities", g.member.id);
  if (limited) return limited;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return Response.json({ error: "corpo da requisição inválido" }, { status: 400 });
  const parsed = parseCommunityInput(b, "create");
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });
  try {
    const community = await createCommunity(g.member.id, parsed.value);
    return Response.json({ community }, { status: 201 });
  } catch (e) {
    if (e instanceof CommunityError && e.code === "slug_taken") {
      return Response.json({ error: e.message }, { status: 409 });
    }
    throw e;
  }
}
