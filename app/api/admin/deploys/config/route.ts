import { auth } from "@clerk/nextjs/server";
import { getMemberByClerkId } from "@/lib/members";
import { deploysEnabled, setDeploysEnabled } from "@/lib/deploys";

export async function PATCH(req: Request) {
  const { userId } = await auth();
  const member = userId ? getMemberByClerkId(userId) : null;
  if (!member)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (member.role !== "admin")
    return Response.json({ error: "Forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  if (typeof body.enabled !== "boolean")
    return Response.json({ error: "enabled boolean obrigatório" }, { status: 400 });
  setDeploysEnabled(body.enabled);
  return Response.json({ enabled: deploysEnabled() });
}
