import { auth } from "@clerk/nextjs/server";
import { getHackathon } from "@/lib/hackathons";
import { getMemberByClerkId } from "@/lib/members";
import { listRegistrants } from "@/lib/registrations";

export async function GET(
  _req: Request,
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
  return Response.json({ registrations: listRegistrants(id) });
}
