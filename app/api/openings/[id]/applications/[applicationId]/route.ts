import { auth } from "@clerk/nextjs/server";
import { getMemberByClerkId } from "@/lib/members";
import { limitOrNull } from "@/lib/ratelimit";
import { TeamError } from "@/lib/teams";
import { respondApplication } from "@/lib/teamOpenings";

// PATCH …/applications/[applicationId] — o time aceita (vira convite) ou
// recusa a candidatura.

const fail = (e: unknown) =>
  Response.json(
    { error: e instanceof Error ? e.message : "Erro" },
    { status: e instanceof TeamError ? e.status : 400 },
  );

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; applicationId: string }> }) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const member = await getMemberByClerkId(userId);
  if (!member) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const limited = limitOrNull(req, "openings", member.id);
  if (limited) return limited;
  const { applicationId } = await params;
  const id = Number(applicationId);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return Response.json({ error: "candidatura inválida" }, { status: 400 });
  }
  const body = await req.json().catch(() => null);
  if (body?.action !== "accept" && body?.action !== "decline") {
    return Response.json({ error: "action (accept|decline) obrigatório" }, { status: 400 });
  }
  try {
    return Response.json({ opening: await respondApplication(member, id, body.action) });
  } catch (e) {
    return fail(e);
  }
}
