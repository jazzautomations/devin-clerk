import { isPublished, rankingFor } from "@/lib/jury";
import { editionGate, forbidden, json } from "@/lib/juryHttp";

type Ctx = { params: Promise<{ id: string }> };

// sigilo: antes da publicação só a organização vê o ranking
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const gate = await editionGate(id, false);
  if (!gate.ok) return gate.res;
  const ranking = await rankingFor(gate.member, id);
  if (!ranking) return forbidden();
  return json({ published: !!(await isPublished(id)), ranking });
}
