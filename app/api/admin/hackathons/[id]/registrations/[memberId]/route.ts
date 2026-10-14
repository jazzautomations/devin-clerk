import { requireEditionManager } from "@/lib/editionAuth";
import { reviewRegistration } from "@/lib/registrations";

// spec 032 — curadoria da fila "pedir lugar": action=approve efetiva a
// inscrição e dispara a recompensa completa (completeRegistration — mesmo
// caminho do register instantâneo); action=reject marca 'rejected'. A
// decisão é reversível (rejected→approved paga a recompensa na hora);
// approve em quem já estava aprovado é no-op sem XP duplo.
// Quem decide é o organizador da edição (admin global vale) — a mesma guarda
// do resto do painel. Staff não aprova.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; memberId: string }> },
) {
  const { id, memberId } = await params;
  const g = await requireEditionManager(id);
  if ("response" in g) return g.response;
  const targetId = Number(memberId);
  if (!Number.isSafeInteger(targetId) || targetId <= 0) {
    return Response.json({ error: "Inscrição não encontrada" }, { status: 404 });
  }

  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const action = b?.action;
  if (action !== "approve" && action !== "reject") {
    return Response.json({ error: "ação deve ser aprovar ou recusar" }, { status: 400 });
  }

  const res = await reviewRegistration(targetId, id, action);
  if (!res) {
    return Response.json({ error: "Inscrição não encontrada" }, { status: 404 });
  }
  if (res.status === "rejected") {
    return Response.json({ status: "rejected", promoted: res.promoted.length });
  }
  // spec 033 FR-009 — edição cheia: aprovado entra na fila de espera
  if (res.status === "waitlist") {
    return Response.json({ status: "waitlist", position: res.position });
  }
  return Response.json({
    status: "approved",
    rewarded: res.rewarded,
    xp: res.xp,
    cardSerial: res.cardSerial,
    // nome legível da conquista (o id é interno)
    newBadges: res.newBadges.map((badge) => badge.name),
  });
}
