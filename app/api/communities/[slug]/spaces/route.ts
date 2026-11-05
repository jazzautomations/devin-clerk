import { requireCommunity, requireCommunityManager } from "@/lib/communityAuth";
import { createSpace, listSpaces, reorderSpaces, SpaceError } from "@/lib/communitySpaces";
import { limitOrNull } from "@/lib/ratelimit";

// Espaços da comunidade (migration 057). GET lista os ativos (a barra e o
// seletor do composer); POST cria e PATCH reordena — dono, organizador ou
// admin. Deslogado: 401 JSON; membro comum escrevendo: 403.

type Ctx = { params: Promise<{ slug: string }> };

const fail = (e: unknown) => {
  if (e instanceof SpaceError) return Response.json({ error: e.message }, { status: e.status });
  throw e;
};

export async function GET(_req: Request, { params }: Ctx) {
  const g = await requireCommunity((await params).slug);
  if ("response" in g) return g.response;
  return Response.json({ spaces: await listSpaces(g.community.id) });
}

export async function POST(req: Request, { params }: Ctx) {
  const g = await requireCommunityManager((await params).slug);
  if ("response" in g) return g.response;
  const limited = limitOrNull(req, "community-spaces", g.member.id);
  if (limited) return limited;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return Response.json({ error: "body inválido" }, { status: 400 });
  try {
    const space = await createSpace(g.community.id, body as Record<string, unknown>);
    return Response.json({ space }, { status: 201 });
  } catch (e) {
    return fail(e);
  }
}

/** { order: number[] } — a barra inteira de espaços ativos, uma vez cada */
export async function PATCH(req: Request, { params }: Ctx) {
  const g = await requireCommunityManager((await params).slug);
  if ("response" in g) return g.response;
  const limited = limitOrNull(req, "community-spaces", g.member.id);
  if (limited) return limited;
  const body = (await req.json().catch(() => null)) as { order?: unknown } | null;
  if (!Array.isArray(body?.order) || body.order.some((x) => typeof x !== "number" || !Number.isInteger(x))) {
    return Response.json({ error: "Mande a ordem como lista de ids." }, { status: 400 });
  }
  try {
    return Response.json({ spaces: await reorderSpaces(g.community.id, body.order as number[]) });
  } catch (e) {
    return fail(e);
  }
}
