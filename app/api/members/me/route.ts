import { auth } from "@clerk/nextjs/server";
import { getMemberByClerkId, updateMemberProfile } from "@/lib/members";
import { checkBadges } from "@/lib/xp";
import { isOpenToValue } from "@/lib/openTo";
import { setOpenTo } from "@/lib/talent";

export async function PATCH(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  // openTo é whitelist comercial (spec 014) — fora dela é 400, nunca
  // sanitização silenciosa; [] limpa o opt-in; campo ausente preserva
  let openTo: string[] | undefined;
  if ("openTo" in body) {
    if (!Array.isArray(body.openTo) || !body.openTo.every(isOpenToValue)) {
      return Response.json({ error: "openTo inválido" }, { status: 400 });
    }
    openTo = body.openTo;
  }
  const member = getMemberByClerkId(userId);
  if (member && openTo !== undefined) setOpenTo(member.id, openTo);
  updateMemberProfile(userId, {
    name: typeof body.name === "string" ? body.name : undefined,
    bio: typeof body.bio === "string" ? body.bio : undefined,
    skills: Array.isArray(body.skills)
      ? body.skills.filter((s: unknown) => typeof s === "string")
      : undefined,
    github: typeof body.github === "string" ? body.github : undefined,
    linkedin: typeof body.linkedin === "string" ? body.linkedin : undefined,
    twitter: typeof body.twitter === "string" ? body.twitter : undefined,
    website: typeof body.website === "string" ? body.website : undefined,
    headline: typeof body.headline === "string" ? body.headline : undefined,
    persona: typeof body.persona === "string" ? body.persona : undefined,
  });
  const newBadges = member ? checkBadges(member.id).map((b) => b.id) : [];
  return Response.json({ ok: true, newBadges });
}
