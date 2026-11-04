import { auth } from "@clerk/nextjs/server";
import { isAreaKey } from "@/lib/areas";
import { getMemberByClerkId } from "@/lib/members";
import { limitOrNull } from "@/lib/ratelimit";
import { TeamError } from "@/lib/teams";
import { createOpening, listOpenings } from "@/lib/teamOpenings";

// Vagas de time (spec 046, onda 3 — migration 045). GET lista as vagas
// abertas (o viewer só recebe candidaturas e e-mail do que é dele); POST abre
// uma vaga do MEU time. 401 JSON deslogado, nunca redirect.

const fail = (e: unknown) =>
  Response.json(
    { error: e instanceof Error ? e.message : "Erro" },
    { status: e instanceof TeamError ? e.status : 400 },
  );

async function currentViewer() {
  const { userId } = await auth();
  if (!userId) return null;
  return getMemberByClerkId(userId);
}

export async function GET(req: Request) {
  const member = await currentViewer();
  if (!member) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const area = sp.get("area");
  const openings = await listOpenings(
    {
      hackathonId: sp.get("edicao")?.trim() || null,
      area: isAreaKey(area) ? area : null,
      cidade: sp.get("cidade")?.trim() || null,
      faculdade: sp.get("faculdade")?.trim() || null,
    },
    member,
  );
  return Response.json({ openings });
}

export async function POST(req: Request) {
  const member = await currentViewer();
  if (!member) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const limited = limitOrNull(req, "openings", member.id);
  if (limited) return limited;
  const body = await req.json().catch(() => null);
  try {
    const opening = await createOpening(member, (body ?? {}) as Record<string, unknown>);
    return Response.json({ opening }, { status: 201 });
  } catch (e) {
    return fail(e);
  }
}
