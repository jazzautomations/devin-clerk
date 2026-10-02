import { auth } from "@clerk/nextjs/server";
import { getHackathon } from "@/lib/hackathons";
import { getMemberByClerkId } from "@/lib/members";
import { reviewRegistration } from "@/lib/registrations";

// spec 032 — curadoria da fila "pedir lugar": action=approve efetiva a
// inscrição e dispara a recompensa completa (completeRegistration — mesmo
// caminho do register instantâneo); action=reject marca 'rejected'. A
// decisão é reversível (rejected→approved paga a recompensa na hora);
// approve em quem já estava aprovado é no-op sem XP duplo.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; memberId: string }> },
) {
  const { userId } = await auth();
  const member = userId ? getMemberByClerkId(userId) : null;
  if (!member) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (member.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id, memberId } = await params;
  if (!getHackathon(id)) {
    return Response.json({ error: "Edição não encontrada" }, { status: 404 });
  }
  const targetId = Number(memberId);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return Response.json(
      { error: "Inscrição não encontrada" },
      { status: 404 },
    );
  }

  const b = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const action = b?.action;
  if (action !== "approve" && action !== "reject") {
    return Response.json(
      { error: "action deve ser 'approve' ou 'reject'" },
      { status: 400 },
    );
  }

  const res = reviewRegistration(targetId, id, action);
  if (!res) {
    return Response.json(
      { error: "Inscrição não encontrada" },
      { status: 404 },
    );
  }
  if (res.status === "rejected") {
    return Response.json({ status: "rejected" });
  }
  return Response.json({
    status: "approved",
    rewarded: res.rewarded,
    xp: res.xp,
    cardSerial: res.cardSerial,
    newBadges: res.newBadges.map((badge) => badge.id),
  });
}
