import { auth } from "@clerk/nextjs/server";
import { getMemberByClerkId } from "@/lib/members";
import { limitOrNull } from "@/lib/ratelimit";
import { TeamError } from "@/lib/teams";
import { closeOpening } from "@/lib/teamOpenings";

// PATCH /api/openings/[id] — o time fecha a vaga (status 'fechada').

const fail = (e: unknown) =>
  Response.json(
    { error: e instanceof Error ? e.message : "Erro" },
    { status: e instanceof TeamError ? e.status : 400 },
  );

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const member = await getMemberByClerkId(userId);
  if (!member) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const limited = limitOrNull(req, "openings", member.id);
  if (limited) return limited;
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return Response.json({ error: "vaga inválida" }, { status: 400 });
  }
  const body = await req.json().catch(() => null);
  if (body?.status !== "fechada") {
    return Response.json({ error: "status 'fechada' obrigatório" }, { status: 400 });
  }
  try {
    return Response.json({ opening: await closeOpening(member, id) });
  } catch (e) {
    return fail(e);
  }
}
