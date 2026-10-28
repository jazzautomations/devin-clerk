import { requireCommunityManager, requireMember } from "@/lib/communityAuth";
import { getCommunityBySlug } from "@/lib/communities";
import { createOpenChallenge, listOpenChallenges, parseOpenChallengeInput } from "@/lib/openChallenges";
import { limitOrNull } from "@/lib/ratelimit";

// GET: os desafios publicados (abertos e encerrados), ?comunidade=slug filtra.
// POST: dono ou organizador cria, em rascunho ou já publicado (publish: true).
// 3 por dia por membro (chave 'open-challenges').

export async function GET(req: Request) {
  const g = await requireMember();
  if ("response" in g) return g.response;
  const slug = new URL(req.url).searchParams.get("comunidade");
  let communityId: number | null = null;
  if (slug) {
    const c = await getCommunityBySlug(slug);
    if (!c || c.hidden) return Response.json({ open: [], closed: [] });
    communityId = c.id;
  }
  return Response.json(await listOpenChallenges({ communityId }));
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const slug = typeof b?.community === "string" ? b.community : "";
  if (!slug) {
    const m = await requireMember();
    if ("response" in m) return m.response;
    return Response.json({ error: "Diga de qual comunidade é o desafio." }, { status: 400 });
  }
  const g = await requireCommunityManager(slug);
  if ("response" in g) return g.response;
  const parsed = parseOpenChallengeInput(b);
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });
  const limited = limitOrNull(req, "open-challenges", g.member.id);
  if (limited) return limited;
  const r = await createOpenChallenge(g.community.id, g.member, parsed.value, { publish: b?.publish === true });
  return Response.json(r, { status: 201 });
}
