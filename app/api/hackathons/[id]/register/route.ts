import { auth } from "@clerk/nextjs/server";
import { getHackathon } from "@/lib/hackathons";
import { getMemberByClerkId } from "@/lib/members";
import { getRegistrationStatus, unregister } from "@/lib/registrations";
import { submitRegistration } from "@/lib/registrationForm";
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
  const hackathon = await getHackathon(id);
  if (!hackathon || !hackathon.active) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const member = await getMemberByClerkId(userId);
  if (!member) {
    return Response.json({ error: "Member not found" }, { status: 404 });
  }
  // spec 031 — flood de inscrições/pedidos é freado por membro (10/h)
  const limited = limitOrNull(req, "register", member.id);
  if (limited) {
    return limited;
  }
  // spec 033 US1 — corpo { consent, answers }: formulário da edição +
  // consentimento LGPD; inscrição, respostas e aceite numa transação só.
  // Corpo vazio/ausente vale como {} (quem já está inscrito recebe o status).
  const body = (await req.json().catch(() => null)) as {
    consent?: unknown;
    answers?: unknown;
  } | null;
  const result = await submitRegistration({
    memberId: member.id,
    hackathonId: hackathon.id,
    answers: body?.answers,
    consent: body?.consent === true,
    ip: clientIp(req),
  });
  if (!result.ok) {
    // frente E — candidato a voluntário/mentor/jurado não compete na mesma edição
    const conflict = result.error.startsWith("conflict_role:");
    return Response.json(
      { error: result.error, questionId: result.questionId ?? null },
      { status: conflict ? 409 : 400 },
    );
  }
  const { status, created, position } = result;
  if (status !== "approved") {
    return Response.json(
      { registered: false, status, created, position, hackathonId: hackathon.id },
      { status: status !== "rejected" && created ? 201 : 200 },
    );
  }
  return Response.json({
    registered: true,
    status: "approved",
    hackathonId: hackathon.id,
    xp: result.reward?.xp ?? "+0",
    cardSerial: result.reward?.cardSerial ?? null,
    newBadges: (result.reward?.newBadges ?? []).map((b) => b.id),
  });
}

// IP do consentimento: 1º salto do x-forwarded-for (Caddy na frente) ou x-real-ip
function clientIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || req.headers.get("x-real-ip") || null;
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
  const hackathon = await getHackathon(id);
  if (!hackathon || !hackathon.active) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const member = await getMemberByClerkId(userId);
  const status = member ? await getRegistrationStatus(member.id, id) : null;
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
  const member = await getMemberByClerkId(userId);
  if (!member) {
    return Response.json({ error: "Member not found" }, { status: 404 });
  }
  // cancelar um aprovado promove o 1º da fila de espera (spec 033 FR-009)
  const { promoted } = await unregister(member.id, id);
  return Response.json({
    registered: false,
    status: null,
    hackathonId: id,
    promoted: promoted.length,
  });
}
