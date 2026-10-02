import { auth } from "@clerk/nextjs/server";
import { createChallenge } from "@/lib/challenges";
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
  if (
    !b ||
    typeof b.sponsor !== "string" ||
    !b.sponsor.trim() ||
    typeof b.title !== "string" ||
    !b.title.trim()
  ) {
    return Response.json(
      { error: "sponsor e title obrigatórios" },
      { status: 400 },
    );
  }
  try {
    const challenge = createChallenge(id, {
      sponsor: b.sponsor,
      title: b.title,
      description: typeof b.description === "string" ? b.description : null,
      prize: typeof b.prize === "string" ? b.prize : null,
    });
    return Response.json({ challenge }, { status: 201 });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Erro" },
      { status: 400 },
    );
  }
}
