import { auth } from "@clerk/nextjs/server";
import { getMemberByClerkId } from "@/lib/members";
import { limitOrNull } from "@/lib/ratelimit";
import { TeamError } from "@/lib/teams";
import { applyToOpening } from "@/lib/teamOpenings";

// POST /api/openings/[id]/applications — candidatura com intro curta.

const fail = (e: unknown) =>
  Response.json(
    { error: e instanceof Error ? e.message : "Erro" },
    { status: e instanceof TeamError ? e.status : 400 },
  );

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
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
  try {
    const r = await applyToOpening(member, id, body?.intro);
    return Response.json({ applicationId: r.applicationId, opening: r.opening }, { status: 201 });
  } catch (e) {
    return fail(e);
  }
}
