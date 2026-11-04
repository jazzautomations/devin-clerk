import { limitOrNull } from "@/lib/ratelimit";
import { followProject, teamExists, unfollowProject } from "@/lib/projectUpdates";
import { currentMember } from "@/lib/session";

// Seguir projeto (spec 046, onda 3, migration 044). POST segue, DELETE deixa
// de seguir; os dois são idempotentes e respondem {following}. 401 deslogado,
// 404 projeto inexistente. Sem contador público: a contagem é do time e mora
// na página, não aqui.

type Ctx = { params: Promise<{ teamId: string }> };

const json = (body: unknown, status = 200) => Response.json(body, { status });

async function gate(req: Request, ctx: Ctx) {
  const me = await currentMember();
  if (!me) return { ok: false as const, res: json({ error: "Unauthorized" }, 401) };
  const n = Number((await ctx.params).teamId);
  if (!Number.isSafeInteger(n) || n <= 0 || !(await teamExists(n))) {
    return { ok: false as const, res: json({ error: "Not found" }, 404) };
  }
  // seguir projeto divide o balde do seguir pessoa (60/h por membro)
  const limited = limitOrNull(req, "member-follows", me.id);
  if (limited) return { ok: false as const, res: limited };
  return { ok: true as const, me, teamId: n };
}

export async function POST(req: Request, ctx: Ctx): Promise<Response> {
  const g = await gate(req, ctx);
  if (!g.ok) return g.res;
  await followProject(g.me.id, g.teamId);
  return json({ following: true });
}

export async function DELETE(req: Request, ctx: Ctx): Promise<Response> {
  const g = await gate(req, ctx);
  if (!g.ok) return g.res;
  await unfollowProject(g.me.id, g.teamId);
  return json({ following: false });
}
