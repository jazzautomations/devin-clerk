import { auth } from "@clerk/nextjs/server";
import { getHackathon } from "@/lib/hackathons";
import { getMemberByClerkId, type Member } from "@/lib/members";
import {
  canManageEdition,
  cancelEditionInvite,
  inviteToEdition,
  isEditionRole,
  listEditionTeam,
  listPendingInvites,
  revokeEditionRole,
} from "@/lib/roles";

// Equipe da edição (spec 033 US7): o organizador (ou admin global) vê quem
// opera a edição, convida por e-mail e tira papel. Staff/mentor/jurado não
// mexem na equipe.

type Guard = { member: Member } | { res: Response };

async function guard(id: string): Promise<Guard> {
  const { userId } = await auth();
  const member = userId ? await getMemberByClerkId(userId) : null;
  if (!member) return { res: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!(await getHackathon(id))) {
    return { res: Response.json({ error: "Edição não encontrada" }, { status: 404 }) };
  }
  if (!(await canManageEdition(member, id))) {
    return { res: Response.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { member };
}

const bad = (error: string) => Response.json({ error }, { status: 400 });

async function body(req: Request): Promise<Record<string, unknown> | null> {
  const b = await req.json().catch(() => null);
  return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guard(id);
  if ("res" in g) return g.res;
  const [team, invites] = await Promise.all([listEditionTeam(id), listPendingInvites(id)]);
  return Response.json({ team, invites });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guard(id);
  if ("res" in g) return g.res;
  const b = await body(req);
  if (!b) return bad("corpo JSON inválido");
  if (!isEditionRole(b.role)) return bad("papel deve ser organizador, staff, mentor ou jurado");
  if (typeof b.email !== "string" || b.email.length > 254) return bad("e-mail inválido");
  try {
    const result = await inviteToEdition(id, b.email, b.role, g.member.id);
    return Response.json({ result }, { status: 201 });
  } catch {
    return bad("e-mail inválido");
  }
}

// remove um papel ({memberId, role}) ou cancela um convite pendente ({email, role})
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guard(id);
  if ("res" in g) return g.res;
  const b = await body(req);
  if (!b) return bad("corpo JSON inválido");
  if (!isEditionRole(b.role)) return bad("papel inválido");
  if (typeof b.email === "string") {
    await cancelEditionInvite(id, b.email, b.role);
    return Response.json({ ok: true });
  }
  const memberId = b.memberId;
  if (typeof memberId !== "number" || !Number.isSafeInteger(memberId) || memberId <= 0) {
    return bad("memberId inválido");
  }
  // tirar o próprio "organizador" pode deixar a edição sem dono — outro
  // organizador (ou o admin global) é quem faz isso
  if (memberId === g.member.id && b.role === "organizador") {
    return bad("você não pode remover o seu próprio papel de organizador");
  }
  await revokeEditionRole(id, memberId, b.role);
  return Response.json({ ok: true });
}
