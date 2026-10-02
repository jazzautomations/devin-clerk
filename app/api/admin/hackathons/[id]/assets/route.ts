import { auth } from "@clerk/nextjs/server";
import { addAsset } from "@/lib/archive";
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
  if (!b || typeof b.type !== "string" || typeof b.url !== "string") {
    return Response.json({ error: "type e url obrigatórios" }, { status: 400 });
  }
  try {
    const asset = addAsset(id, {
      type: b.type,
      url: b.url,
      caption: typeof b.caption === "string" ? b.caption : null,
    });
    return Response.json({ asset }, { status: 201 });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Erro" },
      { status: 400 },
    );
  }
}
