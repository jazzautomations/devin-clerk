import { assertEditionTeam, collectDossier } from "@/lib/dossier";
import { entryErrorResponse } from "@/lib/entriesHttp";
import { editionGate, json } from "@/lib/juryHttp";
import { limitOrNull } from "@/lib/ratelimit";

type Ctx = { params: Promise<{ id: string; teamId: string }> };

// botão "atualizar" do dossiê: lê o GitHub de novo pra um time. Só
// organização; 30 por hora por membro e no mínimo 1 min por time.
export async function POST(req: Request, { params }: Ctx) {
  const { id, teamId } = await params;
  const gate = await editionGate(id, true);
  if (!gate.ok) return gate.res;
  const limited = limitOrNull(req, "dossie-refresh", gate.member.id);
  if (limited) return limited;
  try {
    const team = Number(teamId);
    await assertEditionTeam(id, team);
    const result = await collectDossier(team, { actorId: gate.member.id, manual: true });
    if (result.status === "skipped") return json({ error: "o time ainda não informou repositório" }, 409);
    return json(result);
  } catch (e) {
    return entryErrorResponse(e);
  }
}
