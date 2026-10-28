import {
  canJudgeChallenge,
  challengeErrorResponse,
  getOpenChallenge,
  parsePlaces,
  publishResult,
  requireOpenChallenge,
} from "@/lib/openChallenges";

type Ctx = { params: Promise<{ id: string }> };

// Resultado: quem criou o desafio (ou o dono da comunidade) marca 1º a 3º
// depois do prazo e publica. Uma vez só; cada participante é avisado.
// Body: { places: [{ entryId, place }] }

export async function POST(req: Request, { params }: Ctx) {
  const g = await requireOpenChallenge((await params).id);
  if ("response" in g) return g.response;
  if (!(await canJudgeChallenge(g.member, g.challenge))) return Response.json({ error: "Forbidden" }, { status: 403 });
  const b = (await req.json().catch(() => null)) as { places?: unknown } | null;
  const parsed = parsePlaces(b?.places);
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });
  try {
    const r = await publishResult(g.challenge, g.member, parsed.value);
    return Response.json({ challenge: await getOpenChallenge(g.challenge.id), notified: r.notified });
  } catch (e) {
    return challengeErrorResponse(e);
  }
}
