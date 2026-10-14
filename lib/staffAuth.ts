import { auth } from "@clerk/nextjs/server";
import { getHackathon, type Hackathon } from "@/lib/hackathons";
import { getMemberByClerkId, type Member } from "@/lib/members";
import { hasEditionRole } from "@/lib/roles";

/**
 * Guarda das rotas do dia do evento (check-in, pacote offline, walk-in):
 * 401 deslogado, 404 edição inexistente, 403 sem papel de staff (organizador
 * e admin global valem).
 */
export async function requireEditionStaff(
  hackathonId: string,
): Promise<{ member: Member; hackathon: Hackathon } | { response: Response }> {
  const { userId } = await auth();
  const member = userId ? await getMemberByClerkId(userId) : null;
  if (!member) return { response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  const hackathon = await getHackathon(hackathonId);
  if (!hackathon) return { response: Response.json({ error: "Edição não encontrada" }, { status: 404 }) };
  if (!(await hasEditionRole(member, hackathonId, "staff"))) {
    return { response: Response.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { member, hackathon };
}
