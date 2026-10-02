import { auth } from "@clerk/nextjs/server";
import { getMemberByClerkId } from "@/lib/members";
import { getDeploy, stopDeploy } from "@/lib/deploys";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  const member = userId ? getMemberByClerkId(userId) : null;
  if (!member)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (member.role !== "admin")
    return Response.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await ctx.params;
  if (!getDeploy(id))
    return Response.json({ error: "Deploy não encontrado" }, { status: 404 });
  stopDeploy(id);
  return Response.json({ ok: true });
}
