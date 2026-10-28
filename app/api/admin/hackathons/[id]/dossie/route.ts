import { listDossiers } from "@/lib/dossier";
import { editionGate, json } from "@/lib/juryHttp";

type Ctx = { params: Promise<{ id: string }> };

// dossiê de evidência (migration 029): linha do tempo dos commits de cada
// time contra a janela do evento + declaração. Só organizador/admin da
// edição: é material de investigação, staff e júri não veem.
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const gate = await editionGate(id, true);
  if (!gate.ok) return gate.res;
  return json(await listDossiers(id));
}
