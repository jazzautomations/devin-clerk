import { requireCommunityManager } from "@/lib/communityAuth";
import {
  addSupporter,
  listSupporters,
  parseSupporterInput,
  removeSupporter,
  reorderSupporters,
  SupporterError,
} from "@/lib/communitySupporters";
import { limitOrNull } from "@/lib/ratelimit";

type Ctx = { params: Promise<{ slug: string }> };

// Apoiadores da comunidade (migration 028). Leitura é pública pela página;
// escrever (cadastrar, ordenar, remover) é do dono, organizador ou admin.

const fail = (e: unknown) => {
  if (e instanceof SupporterError) return Response.json({ error: e.message }, { status: e.status });
  throw e;
};

export async function GET(_req: Request, { params }: Ctx) {
  const { slug } = await params;
  const g = await requireCommunityManager(slug);
  if ("response" in g) return g.response;
  return Response.json({ supporters: await listSupporters(g.community.id) });
}

export async function POST(req: Request, { params }: Ctx) {
  const { slug } = await params;
  const g = await requireCommunityManager(slug);
  if ("response" in g) return g.response;
  const limited = limitOrNull(req, "community-supporters", g.member.id);
  if (limited) return limited;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return Response.json({ error: "body inválido" }, { status: 400 });
  const parsed = parseSupporterInput(b);
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });
  try {
    const supporter = await addSupporter(g.community.id, parsed.value, g.member.id);
    return Response.json({ supporter }, { status: 201 });
  } catch (e) {
    return fail(e);
  }
}

/** { order: number[] } — nova ordem da lista inteira */
export async function PATCH(req: Request, { params }: Ctx) {
  const { slug } = await params;
  const g = await requireCommunityManager(slug);
  if ("response" in g) return g.response;
  const limited = limitOrNull(req, "community-supporters", g.member.id);
  if (limited) return limited;
  const b = (await req.json().catch(() => null)) as { order?: unknown } | null;
  if (!Array.isArray(b?.order) || b.order.some((x) => typeof x !== "number" || !Number.isInteger(x))) {
    return Response.json({ error: "Mande a ordem como lista de ids." }, { status: 400 });
  }
  try {
    return Response.json({ supporters: await reorderSupporters(g.community.id, b.order as number[]) });
  } catch (e) {
    return fail(e);
  }
}

/** { id } — tira o apoiador da página */
export async function DELETE(req: Request, { params }: Ctx) {
  const { slug } = await params;
  const g = await requireCommunityManager(slug);
  if ("response" in g) return g.response;
  const limited = limitOrNull(req, "community-supporters", g.member.id);
  if (limited) return limited;
  const b = (await req.json().catch(() => null)) as { id?: unknown } | null;
  if (typeof b?.id !== "number" || !Number.isInteger(b.id)) {
    return Response.json({ error: "Diga qual apoiador sai." }, { status: 400 });
  }
  if (!(await removeSupporter(g.community.id, b.id))) {
    return Response.json({ error: "Apoiador não encontrado nesta comunidade." }, { status: 404 });
  }
  return Response.json({ ok: true });
}
