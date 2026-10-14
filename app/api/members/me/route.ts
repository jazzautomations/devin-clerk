import { auth } from "@clerk/nextjs/server";
import { getMemberByClerkId, updateMemberProfile } from "@/lib/members";
import { checkBadges } from "@/lib/xp";
import { isOpenToValue } from "@/lib/openTo";
import { setOpenTo } from "@/lib/talent";
import { applyContactPatch, parseContactPatch } from "@/lib/contact";

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
  // spec 033 FR-010 — telefone + opt-in de WhatsApp: valida antes de gravar
  // qualquer coisa (400 não deixa perfil salvo pela metade)
  const contact = parseContactPatch(body);
  if ("error" in contact) {
    return Response.json({ error: contact.error }, { status: 400 });
  }
  const member = await getMemberByClerkId(userId);
  if (member) {
    const applied = await applyContactPatch(member.id, contact);
    if ("error" in applied) {
      return Response.json({ error: applied.error }, { status: 400 });
    }
  }
  if (member && openTo !== undefined) await setOpenTo(member.id, openTo);
  await updateMemberProfile(userId, {
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
  const newBadges = member ? (await checkBadges(member.id)).map((b) => b.id) : [];
  return Response.json({ ok: true, newBadges });
}
