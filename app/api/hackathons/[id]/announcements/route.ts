import { auth } from "@clerk/nextjs/server";
import { getMemberByClerkId } from "@/lib/members";
import { getEditionRoles } from "@/lib/roles";
import { getRegistrationStatus } from "@/lib/registrations";
import { listAnnouncementsForMember } from "@/lib/announcements";

// spec 033 US2 — avisos da edição pro inscrito (approved/pending) e pra
// quem tem papel nela. Não é público: aviso pode ter link/local interno.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  const member = userId ? await getMemberByClerkId(userId) : null;
  if (!member) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const status = await getRegistrationStatus(member.id, id);
  const staff = member.role === "admin" || (await getEditionRoles(id, member.id)).length > 0;
  if (!staff && status !== "approved" && status !== "pending" && status !== "waitlist") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return Response.json({
    announcements: await listAnnouncementsForMember(id, member.id, { all: staff }),
  });
}
