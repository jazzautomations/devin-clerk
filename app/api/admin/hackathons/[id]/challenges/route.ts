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
  // sponsor (texto livre) ou sponsorId (entidade) — pelo menos um dos dois
  const hasSponsor =
    (typeof b?.sponsor === "string" && !!b.sponsor.trim()) ||
    (typeof b?.sponsorId === "string" && !!b.sponsorId.trim());
  if (!b || typeof b.title !== "string" || !b.title.trim() || !hasSponsor) {
    return Response.json(
      { error: "title + sponsor (ou sponsorId) obrigatórios" },
      { status: 400 },
    );
  }
  try {
    const challenge = createChallenge(id, {
      sponsor: typeof b.sponsor === "string" ? b.sponsor : undefined,
      sponsorId: typeof b.sponsorId === "string" ? b.sponsorId : undefined,
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
