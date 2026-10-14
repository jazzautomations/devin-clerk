import { CertSettingsError, getCertSettings, updateCertSettings } from "@/lib/certHours";
import { body, editionGate, json } from "@/lib/juryHttp";

type Ctx = { params: Promise<{ id: string }> };

// carga horária por papel, presença mínima, instituição e mapeamento das
// perguntas de curso/instituição/matrícula (roadmap 037 #2) — só organização
export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const gate = await editionGate(id, true);
  if (!gate.ok) return gate.res;
  return json(await getCertSettings(id));
}

export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;
  const gate = await editionGate(id, true);
  if (!gate.ok) return gate.res;
  try {
    return json(await updateCertSettings(id, await body(req)));
  } catch (e) {
    if (e instanceof CertSettingsError) return json({ error: e.message }, e.status);
    throw e;
  }
}
