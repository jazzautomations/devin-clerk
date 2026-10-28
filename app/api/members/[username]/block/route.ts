import { block, unblock } from "@/lib/blocks";
import { getMemberByUsername } from "@/lib/members";
import { limitOrNull } from "@/lib/ratelimit";
import { currentMember } from "@/lib/session";

// Bloquear (migration 032): a pessoa bloqueada não é avisada, para de ver o
// meu perfil (404) e some da minha vista, nos dois sentidos. DELETE desfaz.

type Ctx = { params: Promise<{ username: string }> };
type Who = { id: number };
type Guard = { response: Response } | { me: Who; other: Who };

async function guard(req: Request, { params }: Ctx): Promise<Guard> {
  const me = await currentMember();
  if (!me) return { response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  const { username } = await params;
  const other = await getMemberByUsername(decodeURIComponent(username).toLowerCase());
  if (!other || other.clerkId.startsWith("deleted:")) {
    return { response: Response.json({ error: "Pessoa não encontrada." }, { status: 404 }) };
  }
  if (other.id === me.id) return { response: Response.json({ error: "Não dá pra bloquear você mesmo." }, { status: 400 }) };
  const limited = limitOrNull(req, "blocks", me.id);
  if (limited) return { response: limited };
  return { me, other };
}

export async function POST(req: Request, ctx: Ctx) {
  const g = await guard(req, ctx);
  if ("response" in g) return g.response;
  await block(g.me.id, g.other.id);
  return Response.json({ ok: true, blocked: true });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const g = await guard(req, ctx);
  if ("response" in g) return g.response;
  await unblock(g.me.id, g.other.id);
  return Response.json({ ok: true, blocked: false });
}
