import { auth } from "@clerk/nextjs/server";
import { getMemberByClerkId, updateMemberProfile } from "@/lib/members";
import { checkBadges } from "@/lib/xp";
import { isOpenToValue } from "@/lib/openTo";
import { setOpenTo } from "@/lib/talent";
import { applyContactPatch, parseContactPatch } from "@/lib/contact";
import { normalizeSocial, type SocialKind } from "@/lib/social";
import { parsePersonas, personaLabel } from "@/lib/personas";

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
  // redes: guarda o handle canônico; valor inválido volta 400 com o motivo
  const social: Partial<Record<SocialKind, string>> = {};
  for (const kind of ["github", "linkedin", "twitter", "website"] as const) {
    if (typeof body[kind] !== "string") continue;
    const n = normalizeSocial(kind, body[kind]);
    if ("error" in n) return Response.json({ error: n.error }, { status: 400 });
    social[kind] = n.value;
  }
  let personas: string[] | undefined;
  if (body.personas !== undefined) {
    const p = parsePersonas(body.personas);
    if ("error" in p) return Response.json({ error: p.error }, { status: 400 });
    personas = p.value;
  }
  if (typeof body.persona === "string" && body.persona !== "" && !personaLabel(body.persona)) {
    return Response.json({ error: `persona desconhecida: ${body.persona}` }, { status: 400 });
  }
  await updateMemberProfile(userId, {
    name: typeof body.name === "string" ? body.name : undefined,
    bio: typeof body.bio === "string" ? body.bio : undefined,
    skills: Array.isArray(body.skills)
      ? body.skills.filter((s: unknown) => typeof s === "string")
      : undefined,
    github: social.github,
    linkedin: social.linkedin,
    twitter: social.twitter,
    website: social.website,
    headline: typeof body.headline === "string" ? body.headline : undefined,
    persona: typeof body.persona === "string" ? body.persona : undefined,
    personas,
  });
  const newBadges = member ? (await checkBadges(member.id)).map((b) => b.id) : [];
  return Response.json({ ok: true, newBadges });
}
