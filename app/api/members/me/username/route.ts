import { auth } from "@clerk/nextjs/server";
import { changeUsername, getMemberByClerkId, UsernameError } from "@/lib/members";
import { limitOrNull } from "@/lib/ratelimit";

// frente N #8 — troca única do username (o antigo redireciona pro novo)
export async function POST(req: Request) {
  const { userId } = await auth();
  const member = userId ? await getMemberByClerkId(userId) : null;
  if (!member) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const limited = limitOrNull(req, "username", member.id);
  if (limited) return limited;
  const body = (await req.json().catch(() => null)) as { username?: unknown } | null;
  try {
    const r = await changeUsername(member.id, body?.username);
    return Response.json(r);
  } catch (e) {
    if (e instanceof UsernameError) return Response.json({ error: e.message }, { status: e.status });
    // corrida com outro cadastro no mesmo instante (UNIQUE)
    if (e instanceof Error && /unique|duplicate/i.test(e.message)) {
      return Response.json({ error: "username em uso" }, { status: 409 });
    }
    throw e;
  }
}
