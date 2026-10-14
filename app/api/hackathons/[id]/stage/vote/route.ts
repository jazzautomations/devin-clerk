import { auth } from "@clerk/nextjs/server";
import { getHackathon } from "@/lib/hackathons";
import { getMemberByClerkId, type Member } from "@/lib/members";
import { limitOrNull } from "@/lib/ratelimit";
import { castLiveVote, getMyLiveVote, getSession, StageError, tallyFor, voterStatus } from "@/lib/stage";
import { nudgeStage } from "@/lib/stageStream";

// Modo palco — voto do público no pitch que está no palco.
// GET  → situação de quem está no celular: pode votar? qual a nota atual?
// POST {teamId, score 1–5} → vota/muda a nota (upsert).
// 401 deslogado → 404 edição → 429 flood → 400 nota → 403 sem check-in /
// próprio time → 409 votação fechada ou pitch que já saiu → 200.

type Ctx = { params: Promise<{ id: string }> };

async function gate(id: string): Promise<{ res: Response } | { member: Member }> {
  const { userId } = await auth();
  const member = userId ? await getMemberByClerkId(userId) : null;
  if (!member) return { res: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  const h = await getHackathon(id);
  if (!h || !h.active) return { res: Response.json({ error: "Edição não encontrada" }, { status: 404 }) };
  return { member };
}

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const g = await gate(id);
  if ("res" in g) return g.res;
  const [voter, s] = await Promise.all([voterStatus(id, g.member.id), getSession(id)]);
  const myScore = s.currentTeamId !== null ? await getMyLiveVote(id, g.member.id, s.currentTeamId) : null;
  return Response.json({
    checkedIn: voter.ok,
    ownTeamId: voter.ok ? voter.teamId : null,
    currentTeamId: s.currentTeamId,
    myScore,
  });
}

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const g = await gate(id);
  if ("res" in g) return g.res;
  const limited = limitOrNull(req, "stage-vote", g.member.id);
  if (limited) return limited;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  try {
    const { score } = await castLiveVote(id, g.member.id, b?.teamId, b?.score);
    nudgeStage(id);
    return Response.json({ score, tally: await tallyFor(id, b!.teamId as number) });
  } catch (e) {
    if (e instanceof StageError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
