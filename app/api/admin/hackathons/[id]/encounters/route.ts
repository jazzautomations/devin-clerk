import { auth } from "@clerk/nextjs/server";
import { EncounterError, adminEncounterStats, setEncountersOn } from "@/lib/encounters";
import { getHackathon } from "@/lib/hackathons";
import { getMemberByClerkId } from "@/lib/members";
import { limitOrNull } from "@/lib/ratelimit";
import { hasEditionRole } from "@/lib/roles";

// POST — organizador liga/desliga os encontros e as missões da edição:
// { on?: boolean, missions?: boolean }. As missões nascem desligadas.

async function gate(params: Promise<{ id: string }>) {
  const { userId } = await auth();
  const member = userId ? await getMemberByClerkId(userId) : null;
  if (!member) return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) } as const;
  const id = (await params).id;
  const h = await getHackathon(id);
  if (!h) return { error: Response.json({ error: "Edição não encontrada." }, { status: 404 }) } as const;
  if (!(await hasEditionRole(member, id, "organizador"))) {
    return { error: Response.json({ error: "Só quem organiza liga os encontros." }, { status: 403 }) } as const;
  }
  return { member, h } as const;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await gate(params);
  if (g.error) return g.error;
  return Response.json({ stats: await adminEncounterStats(g.h.id) });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await gate(params);
  if (g.error) return g.error;
  const limited = limitOrNull(req, "encounters", g.member.id);
  if (limited) return limited;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  try {
    const state = await setEncountersOn(g.h.id, { on: body?.on, missions: body?.missions });
    return Response.json({ ...state, stats: await adminEncounterStats(g.h.id) });
  } catch (e) {
    if (e instanceof EncounterError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
