import { auth } from "@clerk/nextjs/server";
import { getHackathon } from "@/lib/hackathons";
import { getMemberByClerkId } from "@/lib/members";
import {
  getPublicListing,
  getRegistrationStatus,
  RegistrationError,
  setPublicListing,
  unregister,
} from "@/lib/registrations";
import { submitRegistration, updateMyDiet } from "@/lib/registrationForm";
import { limitOrNull } from "@/lib/ratelimit";

// spec 032 — edição curada (requiresApproval): POST grava o pedido como
// 'pending' SEM recompensa (201 quando cria, 200 quando já estava pendente
// ou rejeitado — o status salvo nunca reabre/rebaixa, e o DELETE não apaga
// inscrição recusada). Prazo vencido ou edição encerrada = 409; edição que
// não é da Hack Inova = 404.
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
  // frente N #6 — publicListing: true = opt-in explícito de aparecer na
  // lista pública de inscritos (ausente/qualquer outra coisa = não aparece)
  const body = (await req.json().catch(() => null)) as {
    consent?: unknown;
    answers?: unknown;
    publicListing?: unknown;
    terms?: unknown;
  } | null;
  const result = await submitRegistration({
    memberId: member.id,
    hackathonId: hackathon.id,
    answers: body?.answers,
    consent: body?.consent === true,
    ip: clientIp(req),
    publicListing: body?.publicListing === true,
    // frente L — { birthDate, guardian?, conduct, conductVersion?, imageUse?, diet?, allergies?, allergySevere? }
    terms: body?.terms,
  });
  if (!result.ok) {
    // frente E — candidato a voluntário/mentor/jurado não compete na mesma edição
    const conflict = result.error.startsWith("conflict_role:") || result.error === "registration_closed";
    return Response.json(
      {
        error: result.error,
        questionId: result.questionId ?? null,
        ...(result.message ? { message: result.message } : {}),
      },
      { status: result.error === "not_found" ? 404 : conflict ? 409 : 400 },
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
    // nome legível da conquista (o id é interno)
    newBadges: (result.reward?.newBadges ?? []).map((b) => b.name),
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
  const publicListing = member && status ? await getPublicListing(member.id, id) : false;
  return Response.json({ status, publicListing });
}

// frente N #6 — liga/desliga a exibição na lista pública de inscritos
// (dar e revogar o consentimento a qualquer momento: LGPD art. 8º §5º).
// { diet, allergies, allergySevere } corrige a restrição alimentar até o
// início do evento.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const member = await getMemberByClerkId(userId);
  if (!member) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as
    | { publicListing?: unknown; diet?: unknown; allergies?: unknown; allergySevere?: unknown }
    | null;
  if (body && ("diet" in body || "allergies" in body)) {
    const r = await updateMyDiet(member.id, id, body);
    return r.ok ? Response.json(r.value) : Response.json({ error: r.error }, { status: r.status });
  }
  if (typeof body?.publicListing !== "boolean") {
    return Response.json({ error: "publicListing deve ser booleano" }, { status: 400 });
  }
  if (!(await setPublicListing(member.id, id, body.publicListing))) {
    return Response.json({ error: "sem inscrição nesta edição" }, { status: 404 });
  }
  return Response.json({ publicListing: body.publicListing });
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
  // cancelar um aprovado promove o 1º da fila de espera (spec 033 FR-009);
  // recusada, com check-in ou com o evento começado não cancela (409)
  let promoted;
  try {
    ({ promoted } = await unregister(member.id, id));
  } catch (e) {
    if (e instanceof RegistrationError) {
      return Response.json({ error: e.message, code: e.code }, { status: e.status });
    }
    throw e;
  }
  return Response.json({
    registered: false,
    status: null,
    hackathonId: id,
    promoted: promoted.length,
  });
}
