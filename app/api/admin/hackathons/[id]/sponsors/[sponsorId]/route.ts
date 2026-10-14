import { requireEditionManager } from "@/lib/editionAuth";
import { removeEditionSponsor, SponsorError, updateEditionSponsor } from "@/lib/editionSponsors";

type Ctx = { params: Promise<{ id: string; sponsorId: string }> };

const fail = (e: unknown) =>
  Response.json({ error: (e as Error).message }, { status: e instanceof SponsorError ? e.status : 400 });

// nível, logo, site e vínculo com desafios/categorias — só organizador
export async function PATCH(req: Request, { params }: Ctx) {
  const { id, sponsorId } = await params;
  const g = await requireEditionManager(id);
  if ("response" in g) return g.response;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "corpo JSON inválido" }, { status: 400 });
  }
  try {
    return Response.json({ sponsor: await updateEditionSponsor(id, sponsorId, body as Record<string, unknown>) });
  } catch (e) {
    return fail(e);
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id, sponsorId } = await params;
  const g = await requireEditionManager(id);
  if ("response" in g) return g.response;
  try {
    await removeEditionSponsor(id, sponsorId);
    return Response.json({ ok: true });
  } catch (e) {
    return fail(e);
  }
}
