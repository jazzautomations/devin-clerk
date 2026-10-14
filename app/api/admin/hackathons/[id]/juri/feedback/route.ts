import { body, editionGate, json } from "@/lib/juryHttp";
import { feedbackVisible, setFeedbackReleased } from "@/lib/juryFeedback";

type Ctx = { params: Promise<{ id: string }> };

// liga/desliga o feedback do júri pros times (roadmap 037 #9). Ligar antes
// da publicação só deixa armado: o time vê quando o resultado sair.
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const gate = await editionGate(id, true);
  if (!gate.ok) return gate.res;
  const b = await body(req);
  if (typeof b.released !== "boolean") return json({ error: "released precisa ser true ou false" }, 400);
  await setFeedbackReleased(id, b.released);
  return json({ released: b.released, visible: await feedbackVisible(id) });
}
