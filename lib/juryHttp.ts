import { auth } from "@clerk/nextjs/server";
import { getHackathon, type Hackathon } from "@/lib/hackathons";
import { JuryError, JuryPublishIncomplete } from "@/lib/jury";
import { getMemberByClerkId, type Member } from "@/lib/members";
import { canManageEdition } from "@/lib/roles";

// cola HTTP das rotas do júri/certificados: 401 deslogado, 403 sem papel,
// 404 edição inexistente, JuryError → status dela

export const json = (body: unknown, status = 200) => Response.json(body, { status });
export const unauthorized = () => json({ error: "Unauthorized" }, 401);
export const forbidden = () => json({ error: "Forbidden" }, 403);

type Gate =
  | { ok: true; member: Member; hackathon: Hackathon }
  | { ok: false; res: Response };

/** membro logado + edição existente; `manage` exige organizador/admin */
export async function editionGate(hackathonId: string, manage: boolean): Promise<Gate> {
  const { userId } = await auth();
  const member = userId ? await getMemberByClerkId(userId) : null;
  if (!member) return { ok: false, res: unauthorized() };
  const hackathon = await getHackathon(hackathonId);
  if (!hackathon) return { ok: false, res: json({ error: "Edição não encontrada" }, 404) };
  if (manage && !(await canManageEdition(member, hackathonId))) return { ok: false, res: forbidden() };
  return { ok: true, member, hackathon };
}

export async function body(req: Request): Promise<Record<string, unknown>> {
  const b = await req.json().catch(() => null);
  return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
}

export function juryErrorResponse(e: unknown): Response {
  if (e instanceof JuryPublishIncomplete) {
    return json({ error: e.message, missing: e.missing, missingScores: e.missingScores }, e.status);
  }
  if (e instanceof JuryError) return json({ error: e.message }, e.status);
  throw e;
}
