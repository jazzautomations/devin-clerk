import { publishResults } from "@/lib/jury";
import { editionGate, json } from "@/lib/juryHttp";

type Ctx = { params: Promise<{ id: string }> };

// publica o resultado do júri: grava jury_results e o pódio em teams.placement
export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const gate = await editionGate(id, true);
  if (!gate.ok) return gate.res;
  return json(await publishResults(id, gate.member.id));
}
