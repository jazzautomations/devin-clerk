import { requireEditionManager } from "@/lib/editionAuth";
import {
  cancelSponsorInvite,
  getEditionSponsor,
  inviteSponsorPerson,
  listSponsorPeople,
  removeSponsorPerson,
  SponsorError,
} from "@/lib/editionSponsors";

// Pessoas do patrocinador (papel escopado à marca): o organizador convida
// por e-mail e tira o acesso. Só organizador / admin global.
type Ctx = { params: Promise<{ id: string; sponsorId: string }> };

async function body(req: Request): Promise<Record<string, unknown> | null> {
  const b = await req.json().catch(() => null);
  return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
}

export async function GET(_req: Request, { params }: Ctx) {
  const { id, sponsorId } = await params;
  const g = await requireEditionManager(id);
  if ("response" in g) return g.response;
  if (!(await getEditionSponsor(id, sponsorId))) {
    return Response.json({ error: "patrocinador não encontrado nesta edição" }, { status: 404 });
  }
  return Response.json(await listSponsorPeople(id, sponsorId));
}

export async function POST(req: Request, { params }: Ctx) {
  const { id, sponsorId } = await params;
  const g = await requireEditionManager(id);
  if ("response" in g) return g.response;
  const b = await body(req);
  if (!b) return Response.json({ error: "corpo JSON inválido" }, { status: 400 });
  try {
    const result = await inviteSponsorPerson(id, sponsorId, b.email, g.member.id);
    return Response.json({ result }, { status: 201 });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof SponsorError ? e.status : 400 });
  }
}

// tira o acesso ({memberId}) ou cancela convite pendente ({email})
export async function DELETE(req: Request, { params }: Ctx) {
  const { id, sponsorId } = await params;
  const g = await requireEditionManager(id);
  if ("response" in g) return g.response;
  const b = await body(req);
  if (!b) return Response.json({ error: "corpo JSON inválido" }, { status: 400 });
  if (typeof b.email === "string") {
    await cancelSponsorInvite(id, sponsorId, b.email);
    return Response.json({ ok: true });
  }
  const memberId = b.memberId;
  if (typeof memberId !== "number" || !Number.isSafeInteger(memberId) || memberId <= 0) {
    return Response.json({ error: "memberId inválido" }, { status: 400 });
  }
  await removeSponsorPerson(id, sponsorId, memberId);
  return Response.json({ ok: true });
}
