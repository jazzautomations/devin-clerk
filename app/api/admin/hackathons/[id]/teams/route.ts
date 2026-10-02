import { auth } from "@clerk/nextjs/server";
import { createTeam } from "@/lib/archive";
import { getHackathon } from "@/lib/hackathons";
import { getMemberByClerkId } from "@/lib/members";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  const member = userId ? getMemberByClerkId(userId) : null;
  if (!member) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (member.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  if (!getHackathon(id)) {
    return Response.json({ error: "Edição não encontrada" }, { status: 404 });
  }
  const b = await req.json().catch(() => null);
  if (!b || typeof b.name !== "string" || !b.name.trim()) {
    return Response.json({ error: "name obrigatório" }, { status: 400 });
  }
  try {
    const { team, ignoredUsernames } = createTeam(id, {
      name: b.name,
      placement: typeof b.placement === "number" ? b.placement : 0,
      memberUsernames: Array.isArray(b.memberUsernames)
        ? b.memberUsernames
        : [],
      project: b.project && typeof b.project === "object" ? b.project : null,
    });
    return Response.json({ team, ignoredUsernames }, { status: 201 });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Erro" },
      { status: 400 },
    );
  }
}
