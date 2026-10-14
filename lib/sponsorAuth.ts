import { auth } from "@clerk/nextjs/server";
import { getHackathon } from "@/lib/hackathons";
import { getMemberByClerkId, type Member } from "@/lib/members";
import { canManageEdition } from "@/lib/roles";
import { getEditionSponsor, isSponsorMember, type EditionSponsor } from "@/lib/editionSponsors";

/** organizador/admin vê todos; pessoa da marca vê só a sua — nunca a de outra */
export async function canViewSponsorReport(
  actor: { id: number; role: string } | null,
  hackathonId: string,
  sponsorId: string,
): Promise<{ allowed: boolean; manager: boolean }> {
  if (!actor) return { allowed: false, manager: false };
  if (await canManageEdition(actor, hackathonId)) return { allowed: true, manager: true };
  return { allowed: await isSponsorMember(hackathonId, sponsorId, actor.id), manager: false };
}

/**
 * Guarda do relatório: 401 deslogado, 404 edição ou patrocinador fora da
 * edição, 403 quem não é organizador nem da marca (inclusive quem é de
 * OUTRA marca da mesma edição).
 */
export async function requireSponsorViewer(
  hackathonId: string,
  sponsorId: string,
): Promise<{ member: Member; sponsor: EditionSponsor; manager: boolean } | { response: Response }> {
  const { userId } = await auth();
  const member = userId ? await getMemberByClerkId(userId) : null;
  if (!member) return { response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  const [h, sponsor] = await Promise.all([getHackathon(hackathonId), getEditionSponsor(hackathonId, sponsorId)]);
  if (!h || !sponsor) {
    return { response: Response.json({ error: "Patrocinador não encontrado nesta edição" }, { status: 404 }) };
  }
  const { allowed, manager } = await canViewSponsorReport(member, hackathonId, sponsorId);
  if (!allowed) return { response: Response.json({ error: "Forbidden" }, { status: 403 }) };
  return { member, sponsor, manager };
}
