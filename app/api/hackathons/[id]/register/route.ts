import { auth } from "@clerk/nextjs/server";
import { getHackathon } from "@/lib/hackathons";
import { getMemberByClerkId } from "@/lib/members";
import {
  completeRegistration,
  getRegistrationStatus,
  register,
  unregister,
} from "@/lib/registrations";
import { limitOrNull } from "@/lib/ratelimit";

// spec 032 — edição curada (requiresApproval): POST grava o pedido como
// 'pending' SEM recompensa (201 quando cria, 200 quando já estava pendente
// ou rejeitado — INSERT OR IGNORE nunca reabre/rebaixa o status salvo);
// edição aberta efetiva na hora e paga o pacote completo via
// completeRegistration — a MESMA porta que a aprovação admin usa.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const hackathon = getHackathon(id);
  if (!hackathon || !hackathon.active) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const member = getMemberByClerkId(userId);
  if (!member) {
    return Response.json({ error: "Member not found" }, { status: 404 });
  }
  // spec 031 — flood de inscrições/pedidos é freado por membro (10/h)
  const limited = limitOrNull(req, "register", member.id);
  if (limited) {
    return limited;
  }
  const { status, created } = register(member.id, hackathon.id);
  if (status !== "approved") {
    return Response.json(
      { registered: false, status, created, hackathonId: hackathon.id },
      { status: status === "pending" && created ? 201 : 200 },
    );
  }
  const reward = completeRegistration(member.id, hackathon.id);
  return Response.json({
    registered: true,
    status: "approved",
    hackathonId: hackathon.id,
    xp: reward.xp,
    cardSerial: reward.cardSerial,
    newBadges: reward.newBadges.map((b) => b.id),
  });
}

// status da inscrição do membro na edição — alimenta o estado inicial dos
// CTAs (ex.: HackathonCard resolve "aguardando aprovação" sem reload)
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const hackathon = getHackathon(id);
  if (!hackathon || !hackathon.active) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const member = getMemberByClerkId(userId);
  const status = member ? getRegistrationStatus(member.id, id) : null;
  return Response.json({ status });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const member = getMemberByClerkId(userId);
  if (!member) {
    return Response.json({ error: "Member not found" }, { status: 404 });
  }
  unregister(member.id, id);
  return Response.json({ registered: false, status: null, hackathonId: id });
}
