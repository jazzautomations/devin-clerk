import { requireEditionManager } from "@/lib/editionAuth";
import { limitOrNull } from "@/lib/ratelimit";
import { reviewApplication } from "@/lib/roleApplications";

// frente E (spec 033) — decisão do organizador: { action: approve|reject,
// note? }. Aprovar concede o papel da edição; recusar só registra. Já
// decidida → 409 (tirar papel é na aba equipe).
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; applicationId: string }> },
) {
  const { id, applicationId } = await params;
  const g = await requireEditionManager(id);
  if ("response" in g) return g.response;
  const limited = limitOrNull(req, "application-review", g.member.id);
  if (limited) return limited;
  const appId = Number(applicationId);
  if (!Number.isInteger(appId) || appId <= 0) {
    return Response.json({ error: "Candidatura não encontrada" }, { status: 404 });
  }
  const b = (await req.json().catch(() => null)) as { action?: unknown; note?: unknown } | null;
  if (b?.action !== "approve" && b?.action !== "reject") {
    return Response.json({ error: "action deve ser 'approve' ou 'reject'" }, { status: 400 });
  }
  if (b.note !== undefined && b.note !== null && typeof b.note !== "string") {
    return Response.json({ error: "note deve ser texto" }, { status: 400 });
  }
  const r = await reviewApplication({
    hackathonId: id,
    applicationId: appId,
    action: b.action,
    reviewerId: g.member.id,
    note: typeof b.note === "string" ? b.note : null,
  });
  if (!r.ok) {
    if (r.error === "not_found") return Response.json({ error: "Candidatura não encontrada" }, { status: 404 });
    if (r.error === "already_reviewed") {
      return Response.json({ error: "candidatura já decidida" }, { status: 409 });
    }
    return Response.json(
      { error: "a pessoa está inscrita como participante nesta edição — não pode ajudar na mesma" },
      { status: 409 },
    );
  }
  return Response.json(r);
}
