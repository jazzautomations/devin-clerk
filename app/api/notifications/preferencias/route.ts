import { auth } from "@clerk/nextjs/server";
import { getMemberByClerkId } from "@/lib/members";
import { getPrefs, isPrefGroup, setPref } from "@/lib/notifications";
import { limitOrNull } from "@/lib/ratelimit";

// Preferências por grupo (migration 040). social e comunidade: liga e
// desliga no app. digest: liga e desliga o e-mail de segunda. O grupo
// essencial não aparece aqui porque não desliga.

async function me() {
  const { userId } = await auth();
  return userId ? getMemberByClerkId(userId) : null;
}

export async function GET() {
  const member = await me();
  if (!member) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json({ prefs: await getPrefs(member.id) });
}

export async function PATCH(req: Request) {
  const member = await me();
  if (!member) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const limited = limitOrNull(req, "notification-prefs", member.id);
  if (limited) return limited;
  const body = await req.json().catch(() => null);
  const group = body?.group;
  if (!isPrefGroup(group)) {
    return Response.json({ error: "Grupo inválido. Use social, comunidade ou digest." }, { status: 400 });
  }
  // cada grupo tem um canal que a pessoa controla
  const field = group === "digest" ? "email" : "inApp";
  const value = body?.[field];
  if (typeof value !== "boolean") {
    return Response.json({ error: `Mande ${field} como true ou false.` }, { status: 400 });
  }
  await setPref(member.id, group, { [field]: value });
  return Response.json({ prefs: await getPrefs(member.id) });
}
