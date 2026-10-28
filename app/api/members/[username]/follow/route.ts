import { isBlockedEither } from "@/lib/blocks";
import { followMember, notifyNewFollower, unfollowMember } from "@/lib/memberFollows";
import { getMemberByUsername, resolveUsernameRedirect, type Member } from "@/lib/members";
import { limitOrNull } from "@/lib/ratelimit";
import { currentMember } from "@/lib/session";

// Seguir pessoa (migration 033). POST segue, DELETE deixa de seguir; os dois
// são idempotentes e respondem {following}. Com bloqueio em qualquer sentido a
// resposta é a mesma de quem não existe (404), pra não confirmar o bloqueio.

type Ctx = { params: Promise<{ username: string }> };
type Guard = { response: Response } | { me: Member; other: Member };

const notFound = () => Response.json({ error: "Pessoa não encontrada." }, { status: 404 });

async function resolve(raw: string): Promise<Member | null> {
  let handle: string;
  try {
    handle = decodeURIComponent(raw).trim().toLowerCase();
  } catch {
    return null;
  }
  const found = await getMemberByUsername(handle);
  if (found) return found;
  // @ antigo: o link velho do perfil continua valendo
  const moved = await resolveUsernameRedirect(handle);
  return moved ? getMemberByUsername(moved) : null;
}

async function guard(req: Request, { params }: Ctx): Promise<Guard> {
  const me = await currentMember();
  if (!me) return { response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  const other = await resolve((await params).username);
  if (!other || other.clerkId.startsWith("deleted:")) return { response: notFound() };
  if (other.id === me.id) return { response: Response.json({ error: "Você não pode seguir a si mesmo" }, { status: 400 }) };
  const limited = limitOrNull(req, "member-follows", me.id);
  if (limited) return { response: limited };
  if (await isBlockedEither(me.id, other.id)) return { response: notFound() };
  return { me, other };
}

export async function POST(req: Request, ctx: Ctx) {
  const g = await guard(req, ctx);
  if ("response" in g) return g.response;
  const r = await followMember(g.me.id, g.other.id);
  if (r === "blocked") return notFound();
  if (r === "self") return Response.json({ error: "Você não pode seguir a si mesmo" }, { status: 400 });
  if (r === "ok") await notifyNewFollower({ id: g.me.id, username: g.me.username }, g.other.id);
  return Response.json({ following: true });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const g = await guard(req, ctx);
  if ("response" in g) return g.response;
  await unfollowMember(g.me.id, g.other.id);
  return Response.json({ following: false });
}
