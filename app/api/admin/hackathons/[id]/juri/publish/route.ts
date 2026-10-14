import { juryTeamMemberIds, publishResults } from "@/lib/jury";
import { body, editionGate, json, juryErrorResponse } from "@/lib/juryHttp";
import { isFeedbackReleased, notifyFeedbackReleased } from "@/lib/juryFeedback";
import { notify } from "@/lib/notifications";

type Ctx = { params: Promise<{ id: string }> };

// publica o resultado do júri: grava jury_results (com o ranking congelado)
// e o pódio em teams.placement. Com avaliação faltando: 409 com a contagem,
// a não ser que venha {force: true, reason}. Na primeira publicação, avisa
// quem é dos times avaliados e, se o feedback já estava liberado, avisa
// também que ele abriu.
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const gate = await editionGate(id, true);
  if (!gate.ok) return gate.res;
  const b = await body(req);
  try {
    const res = await publishResults(id, gate.member.id, { force: b.force === true, reason: b.reason });
    if (res.first) {
      for (const memberId of await juryTeamMemberIds(id)) {
        await notify(memberId, {
          type: "jury_result",
          text: `O resultado do júri de ${gate.hackathon.name} saiu.`,
          href: `/h/${id}`,
        });
      }
      if (await isFeedbackReleased(id)) await notifyFeedbackReleased(id);
    }
    return json(res);
  } catch (e) {
    return juryErrorResponse(e);
  }
}
