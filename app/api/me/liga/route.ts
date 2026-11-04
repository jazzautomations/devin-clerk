import { auth } from "@clerk/nextjs/server";
import { leagueOptIn, ligaEnabled, setLeagueOptIn } from "@/lib/league";
import { getMemberByClerkId } from "@/lib/members";
import { limitOrNull } from "@/lib/ratelimit";

// Liga do semestre (migration 054): o opt-in da lista. Com a flag desligada
// (HACKAHUB_LIGA_ON) a rota responde 404 — a feature não existe pra quem não
// tem a flag, igual à página /liga.

const off = () => Response.json({ error: "Not found" }, { status: 404 });
const unauthorized = () => Response.json({ error: "Unauthorized" }, { status: 401 });

export async function GET() {
  if (!ligaEnabled()) return off();
  const { userId } = await auth();
  if (!userId) return unauthorized();
  const member = await getMemberByClerkId(userId);
  if (!member) return unauthorized();
  return Response.json({ enabled: true, optIn: await leagueOptIn(member.id) });
}

export async function PATCH(req: Request) {
  if (!ligaEnabled()) return off();
  const { userId } = await auth();
  if (!userId) return unauthorized();
  const member = await getMemberByClerkId(userId);
  if (!member) return unauthorized();
  const limited = limitOrNull(req, "liga", member.id);
  if (limited) return limited;
  const body = (await req.json().catch(() => null)) as { optIn?: unknown } | null;
  if (typeof body?.optIn !== "boolean") {
    return Response.json({ error: "optIn precisa ser true ou false" }, { status: 400 });
  }
  return Response.json({ ok: true, optIn: await setLeagueOptIn(member.id, body.optIn) });
}
