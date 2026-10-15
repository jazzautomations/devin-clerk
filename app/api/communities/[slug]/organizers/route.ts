import { cancelCommunityInvite, CommunityError, inviteOrganizer, removeOrganizer } from "@/lib/communities";
import { requireCommunityOwner } from "@/lib/communityAuth";
import { limitOrNull } from "@/lib/ratelimit";

type Ctx = { params: Promise<{ slug: string }> };

// Só o dono (ou o admin global) chama organizador e tira o papel.
export async function POST(req: Request, { params }: Ctx) {
  const { slug } = await params;
  const g = await requireCommunityOwner(slug);
  if ("response" in g) return g.response;
  const limited = limitOrNull(req, "community-invites", g.member.id);
  if (limited) return limited;
  const b = (await req.json().catch(() => null)) as { email?: unknown } | null;
  if (typeof b?.email !== "string") return Response.json({ error: "Informe o e-mail." }, { status: 400 });
  try {
    const status = await inviteOrganizer(g.community, b.email, g.member.id);
    return Response.json({ status }, { status: status === "pending" ? 202 : 200 });
  } catch (e) {
    if (e instanceof CommunityError) return Response.json({ error: e.message }, { status: 400 });
    throw e;
  }
}

// { memberId } tira o papel (a pessoa continua membro); { email } cancela convite
export async function DELETE(req: Request, { params }: Ctx) {
  const { slug } = await params;
  const g = await requireCommunityOwner(slug);
  if ("response" in g) return g.response;
  const b = (await req.json().catch(() => null)) as { memberId?: unknown; email?: unknown } | null;
  if (typeof b?.email === "string") {
    await cancelCommunityInvite(g.community.id, b.email);
    return Response.json({ ok: true });
  }
  if (typeof b?.memberId !== "number" || !Number.isInteger(b.memberId)) {
    return Response.json({ error: "Informe quem sai da organização." }, { status: 400 });
  }
  const removed = await removeOrganizer(g.community.id, b.memberId);
  if (!removed) return Response.json({ error: "Essa pessoa não organiza a comunidade." }, { status: 404 });
  return Response.json({ ok: true });
}
