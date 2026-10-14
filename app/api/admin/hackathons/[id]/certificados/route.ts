import { issueCertificates } from "@/lib/certificates";
import { isOver } from "@/lib/hackathons";
import { editionGate, json } from "@/lib/juryHttp";

type Ctx = { params: Promise<{ id: string }> };

// emite (ou completa) os certificados da edição encerrada — idempotente
export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const gate = await editionGate(id, true);
  if (!gate.ok) return gate.res;
  if (!isOver(gate.hackathon)) {
    return json({ error: "A edição ainda não encerrou" }, 409);
  }
  return json(await issueCertificates(id));
}
