import { canManageCommunity, getCommunityBySlug, isCommunityOwner, type Community } from "@/lib/communities";
import type { Member } from "@/lib/members";
import { currentMember } from "@/lib/session";

// Guardas das rotas de comunidade: 401 deslogado, 404 comunidade que não
// existe (ou escondida pela moderação, pra quem não é admin), 403 sem papel.
// O papel é sempre o da comunidade do endereço: ser dono de uma não dá nada
// em outra.

type Ok = { member: Member; community: Community };
type Fail = { response: Response };

const json = (error: string, status: number) => Response.json({ error }, { status });

export async function requireMember(): Promise<{ member: Member } | Fail> {
  const member = await currentMember();
  if (!member) return { response: json("Unauthorized", 401) };
  return { member };
}

export async function requireCommunity(slug: string): Promise<Ok | Fail> {
  const g = await requireMember();
  if ("response" in g) return g;
  const community = await getCommunityBySlug(slug);
  if (!community || (community.hidden && g.member.role !== "admin")) {
    return { response: json("Comunidade não encontrada", 404) };
  }
  return { member: g.member, community };
}

/** dono, organizador da comunidade ou admin global */
export async function requireCommunityManager(slug: string): Promise<Ok | Fail> {
  const g = await requireCommunity(slug);
  if ("response" in g) return g;
  if (!(await canManageCommunity(g.member, g.community.id))) return { response: json("Forbidden", 403) };
  return g;
}

/** dono da comunidade ou admin global */
export async function requireCommunityOwner(slug: string): Promise<Ok | Fail> {
  const g = await requireCommunity(slug);
  if ("response" in g) return g;
  if (!(await isCommunityOwner(g.member, g.community.id))) return { response: json("Forbidden", 403) };
  return g;
}
