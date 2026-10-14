import { auth } from "@clerk/nextjs/server";
import { getHackathon, type Hackathon } from "@/lib/hackathons";
import { getMemberByClerkId, type Member } from "@/lib/members";
import { getMyNps, getNpsWindow, npsPhase, npsRoleFor, NPS_QUESTIONS, NpsError, submitNps } from "@/lib/nps";

// Pesquisa NPS de quem esteve na edição (roadmap 037 #11). GET = estado +
// perguntas do papel + minha resposta; PUT grava/edita (uma por pessoa).
// 401 deslogado, 404 edição, 403 sem check-in/papel, 409 fora da janela.
type Ctx = { params: Promise<{ id: string }> };

async function guard(id: string): Promise<{ response: Response } | { member: Member; h: Hackathon }> {
  const { userId } = await auth();
  const member = userId ? await getMemberByClerkId(userId) : null;
  if (!member) return { response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  const h = await getHackathon(id);
  if (!h) return { response: Response.json({ error: "Edição não encontrada" }, { status: 404 }) };
  return { member, h };
}

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const g = await guard(id);
  if ("response" in g) return g.response;
  const role = await npsRoleFor(id, g.member.id);
  if (!role) return Response.json({ error: "a pesquisa é só pra quem esteve na edição" }, { status: 403 });
  const [w, answer] = await Promise.all([getNpsWindow(id), getMyNps(id, g.member.id)]);
  return Response.json({
    role,
    questions: NPS_QUESTIONS[role],
    phase: w ? npsPhase(w) : "antes",
    closesAt: w?.closesAt?.toISOString() ?? null,
    answer,
  });
}

export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;
  const g = await guard(id);
  if ("response" in g) return g.response;
  const body = await req.json().catch(() => null);
  try {
    return Response.json({ answer: await submitNps(id, g.member.id, body) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: e instanceof NpsError ? e.status : 400 });
  }
}
