import { auth } from "@clerk/nextjs/server";
import { getMemberByClerkId } from "@/lib/members";
import { teamFeedbackFor } from "@/lib/juryFeedback";

type Ctx = { params: Promise<{ teamId: string }> };

// feedback do júri pro time (roadmap 037 #9): 401 deslogado → 404 time
// inexistente → 403 quem não é do time → 200 {released:false} antes da
// publicação/liberação (sem nenhum dado) → 200 {released:true, feedback}.
export async function GET(_req: Request, ctx: Ctx) {
  const { userId } = await auth();
  const member = userId ? await getMemberByClerkId(userId) : null;
  const res = await teamFeedbackFor(member, Number((await ctx.params).teamId));
  const headers = { "Cache-Control": "private, no-store" };
  switch (res.status) {
    case "unauthorized":
      return Response.json({ error: "Unauthorized" }, { status: 401, headers });
    case "not_found":
      return Response.json({ error: "Time não encontrado" }, { status: 404, headers });
    case "forbidden":
      return Response.json({ error: "Forbidden" }, { status: 403, headers });
    case "hidden":
      return Response.json({ released: false }, { headers });
    case "ok":
      return Response.json({ released: true, feedback: res.feedback }, { headers });
  }
}
