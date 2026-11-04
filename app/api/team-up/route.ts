import { auth } from "@clerk/nextjs/server";
import { getMemberByClerkId } from "@/lib/members";
import { limitOrNull } from "@/lib/ratelimit";
import { TeamError } from "@/lib/teams";
import { signalTeamUp } from "@/lib/teamOpenings";

// POST /api/team-up — "bora fazer junto" (team_up_signals). O sinal é
// silencioso: a resposta não conta se a outra pessoa já marcou; só quando os
// dois marcam o app age (convite, time novo ou conexão).

const fail = (e: unknown) =>
  Response.json(
    { error: e instanceof Error ? e.message : "Erro" },
    { status: e instanceof TeamError ? e.status : 400 },
  );

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const member = await getMemberByClerkId(userId);
  if (!member) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const limited = limitOrNull(req, "openings", member.id);
  if (limited) return limited;
  const body = await req.json().catch(() => null);
  try {
    return Response.json(await signalTeamUp(member, (body ?? {}) as Record<string, unknown>));
  } catch (e) {
    return fail(e);
  }
}
