import { saveScores } from "@/lib/jury";
import { body, editionGate, json, juryErrorResponse } from "@/lib/juryHttp";

type Ctx = { params: Promise<{ id: string }> };

// jurado grava as notas de um projeto atribuído a ele — a lib recusa (403)
// projeto não atribuído e o próprio time, venha de quem vier
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const gate = await editionGate(id, false);
  if (!gate.ok) return gate.res;
  const b = await body(req);
  const scores = Array.isArray(b.scores)
    ? b.scores.map((s: { criterionId?: unknown; score?: unknown } | null) => ({
        criterionId: Number(s?.criterionId),
        score: Number(s?.score),
      }))
    : [];
  try {
    await saveScores(id, gate.member.id, Number(b.teamId), scores, typeof b.comment === "string" ? b.comment : null);
    return json({ ok: true });
  } catch (e) {
    return juryErrorResponse(e);
  }
}
