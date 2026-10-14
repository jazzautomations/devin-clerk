import { auth } from "@clerk/nextjs/server";
import { getHackathon } from "@/lib/hackathons";
import { getMemberByClerkId } from "@/lib/members";
import { limitOrNull } from "@/lib/ratelimit";
import { memberTeamFor, TeamError } from "@/lib/teams";
import {
  inviteToTeam,
  listMyInvites,
  listPendingTeamInvites,
  respondInvite,
} from "@/lib/teamInvites";

// frente N #4 — convite de time: GET (meus convites + pendentes do meu
// time), POST {usernames} (integrante convida), PATCH {inviteId, action}
// (convidado aceita/recusa)

const fail = (e: unknown) =>
  Response.json(
    { error: e instanceof Error ? e.message : "Erro" },
    { status: e instanceof TeamError ? e.status : 400 },
  );

async function gate(params: Promise<{ id: string }>) {
  const { userId } = await auth();
  const member = userId ? await getMemberByClerkId(userId) : null;
  if (!member) return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) } as const;
  const h = await getHackathon((await params).id);
  if (!h || !h.active) return { error: Response.json({ error: "Not found" }, { status: 404 }) } as const;
  return { member, h } as const;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await gate(params);
  if (g.error) return g.error;
  const team = await memberTeamFor(g.h.id, g.member.username);
  const [invites, pending] = await Promise.all([
    listMyInvites(g.member.id, g.h.id),
    team ? listPendingTeamInvites(team.id) : Promise.resolve([] as string[]),
  ]);
  return Response.json({ invites, pending });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await gate(params);
  if (g.error) return g.error;
  const limited = limitOrNull(req, "team", g.member.id);
  if (limited) return limited;
  const b = await req.json().catch(() => null);
  if (!b || !Array.isArray(b.usernames) || b.usernames.length > 20) {
    return Response.json({ error: "usernames (lista, até 20) obrigatório" }, { status: 400 });
  }
  try {
    const r = await inviteToTeam(g.h.id, g.member, b.usernames);
    return Response.json({ ...r, pending: await listPendingTeamInvites((await memberTeamFor(g.h.id, g.member.username))!.id) });
  } catch (e) {
    return fail(e);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await gate(params);
  if (g.error) return g.error;
  const b = await req.json().catch(() => null);
  const inviteId = b && Number.isSafeInteger(b.inviteId) && b.inviteId > 0 ? (b.inviteId as number) : null;
  if (!inviteId || (b.action !== "accept" && b.action !== "decline")) {
    return Response.json({ error: "inviteId e action (accept|decline) obrigatórios" }, { status: 400 });
  }
  try {
    const r = await respondInvite(inviteId, g.member, b.action, g.h.id);
    const team = r.status === "accepted" ? await memberTeamFor(g.h.id, g.member.username) : null;
    return Response.json({ status: r.status, team });
  } catch (e) {
    return fail(e);
  }
}
