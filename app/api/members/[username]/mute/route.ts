import { mute, unmute } from "@/lib/blocks";
import { getMemberByUsername } from "@/lib/members";
import { limitOrNull } from "@/lib/ratelimit";
import { currentMember } from "@/lib/session";

// Silenciar (migration 032): posts e notificações da pessoa somem pra mim.
// Ela não é avisada e continua vendo tudo. DELETE desfaz.

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
  if (other.id === me.id) return { response: Response.json({ error: "Não dá pra silenciar você mesmo." }, { status: 400 }) };
  const limited = limitOrNull(req, "blocks", me.id);
  if (limited) return { response: limited };
  return { me, other };
}

export async function POST(req: Request, ctx: Ctx) {
  const g = await guard(req, ctx);
  if ("response" in g) return g.response;
  await mute(g.me.id, g.other.id);
  return Response.json({ ok: true, muted: true });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const g = await guard(req, ctx);
  if ("response" in g) return g.response;
  await unmute(g.me.id, g.other.id);
  return Response.json({ ok: true, muted: false });
}
