import { auth } from "@clerk/nextjs/server";
import { getMemberByClerkId } from "@/lib/members";
import { toggleVote, voteCountFor, VoteError } from "@/lib/votes";

type Ctx = { params: Promise<{ teamId: string }> };

// escolha do povo (spec 025): um POST alterna o voto do membro no projeto.
// 401 sem sessão/member → 404 time inválido ou sem projeto → 403 próprio
// time → 200 {voted, count}. Sem XP: voto é sinal, não moeda.
export async function POST(_req: Request, ctx: Ctx) {
  const { userId } = await auth();
  const member = userId ? getMemberByClerkId(userId) : null;
  if (!member) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const teamId = Number((await ctx.params).teamId);
  try {
    const { voted } = toggleVote(member.id, teamId);
    return Response.json({ voted, count: voteCountFor(teamId) });
  } catch (e) {
    if (e instanceof VoteError) {
      return Response.json({ error: e.message }, { status: e.status });
    }
    throw e;
  }
}
