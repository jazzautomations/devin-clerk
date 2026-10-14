import { auth } from "@clerk/nextjs/server";
import { getHackathon, type Hackathon } from "@/lib/hackathons";
import { getMemberByClerkId, type Member } from "@/lib/members";
import { getImageConsent, getImageConsentHistory, setImageConsent } from "@/lib/eventTerms";
import { limitOrNull } from "@/lib/ratelimit";

// Uso de imagem por edição (roadmap 037 #3): o próprio inscrito autoriza ou
// revoga a qualquer momento (perfil ou página da edição). Cada mudança vira
// uma linha nova no histórico — é a prova de quando valeu o quê.
async function guard(id: string): Promise<{ member: Member; h: Hackathon } | { response: Response }> {
  const { userId } = await auth();
  if (!userId) return { response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  const member = await getMemberByClerkId(userId);
  if (!member) return { response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  const h = await getHackathon(id);
  if (!h) return { response: Response.json({ error: "Not found" }, { status: 404 }) };
  return { member, h };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard((await params).id);
  if ("response" in g) return g.response;
  const [state, history] = await Promise.all([
    getImageConsent(g.member.id, g.h.id),
    getImageConsentHistory(g.member.id, g.h.id),
  ]);
  return Response.json({ ...state, history: history.map((r) => ({ ...r, granted: r.granted === 1 })) });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const g = await guard((await params).id);
  if ("response" in g) return g.response;
  const limited = limitOrNull(req, "image-consent", g.member.id);
  if (limited) return limited;
  const body = (await req.json().catch(() => null)) as { granted?: unknown; source?: unknown } | null;
  if (typeof body?.granted !== "boolean") {
    return Response.json({ error: "granted precisa ser true ou false" }, { status: 400 });
  }
  const source = body.source === "perfil" ? "perfil" : "edicao";
  const r = await setImageConsent(g.member.id, g.h.id, body.granted, source);
  if (!r.ok) return Response.json({ error: r.error }, { status: 403 });
  return Response.json(r.state);
}
