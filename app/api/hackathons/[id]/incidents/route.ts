import { auth } from "@clerk/nextjs/server";
import { getHackathon } from "@/lib/hackathons";
import { getMemberByClerkId } from "@/lib/members";
import { createIncident, validateIncident } from "@/lib/incidents";
import { limitOrNull } from "@/lib/ratelimit";

// Canal de denúncia da edição (roadmap 037 #7). Aceita anônimo: sem login
// (ou com `anonymous: true`) a denúncia não grava memberId nem IP. O IP só
// serve de chave do rate-limit, que vive em memória (lib/ratelimit).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const h = await getHackathon(id);
  if (!h || !h.partner) return Response.json({ error: "Not found" }, { status: 404 });
  const { userId } = await auth();
  const member = userId ? await getMemberByClerkId(userId) : null;
  const limited = limitOrNull(req, "incidents", member?.id ?? null);
  if (limited) return limited;
  const v = validateIncident(await req.json().catch(() => null));
  if (!v.ok) return Response.json({ error: v.error }, { status: 400 });
  await createIncident(h.id, v.value, member?.id ?? null);
  return Response.json({ ok: true, anonymous: v.value.anonymous || !member }, { status: 201 });
}
