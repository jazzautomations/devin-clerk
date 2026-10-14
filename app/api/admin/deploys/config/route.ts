import { auth } from "@clerk/nextjs/server";
import { getMemberByClerkId } from "@/lib/members";
import {
  deployToolAllowed,
  deploysEnabled,
  setDeploysEnabled,
} from "@/lib/deploys";

export async function PATCH(req: Request) {
  const { userId } = await auth();
  const member = userId ? await getMemberByClerkId(userId) : null;
  if (!member)
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (member.role !== "admin")
    return Response.json({ error: "Forbidden" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  if (typeof body.enabled !== "boolean")
    return Response.json({ error: "enabled boolean obrigatório" }, { status: 400 });
  if (body.enabled && !deployToolAllowed())
    return Response.json(
      { error: "Deploy tool desligado neste ambiente" },
      { status: 409 },
    );
  await setDeploysEnabled(body.enabled);
  return Response.json({ enabled: await deploysEnabled() });
}
