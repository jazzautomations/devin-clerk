import { auth, clerkClient } from "@clerk/nextjs/server";
import { getMemberByClerkId, updateMemberProfile } from "@/lib/members";
import { checkBadges } from "@/lib/xp";
import { isOpenToValue } from "@/lib/openTo";
import { setOpenTo } from "@/lib/talent";
import { applyContactPatch, parseContactPatch } from "@/lib/contact";
import { normalizeSocial, type SocialKind } from "@/lib/social";
import { parsePersonas, personaLabel } from "@/lib/personas";
import { deleteMemberData } from "@/lib/privacy";
import { saveOnboarding } from "@/lib/members";
import { LIMITS, shortText } from "@/lib/onboarding";
import { parseAreas, type AreaKey } from "@/lib/areas";
import { isRecadosFrom, type RecadosFrom } from "@/lib/recados";
import { setPins } from "@/lib/profileFacts";

export async function PATCH(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return Response.json({ error: "não deu pra ler os dados enviados" }, { status: 400 });
  }
  // openTo é whitelist comercial (spec 014) — fora dela é 400, nunca
  // sanitização silenciosa; [] limpa o opt-in; campo ausente preserva
  let openTo: string[] | undefined;
  if ("openTo" in body) {
    if (!Array.isArray(body.openTo) || !body.openTo.every(isOpenToValue)) {
      return Response.json({ error: "opção de disponibilidade inválida" }, { status: 400 });
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
  // spec 039 — cidade, instituição e curso (opcionais; "" limpa)
  const extra: { city?: string | null; institution?: string | null; course?: string | null } = {};
  for (const k of ["city", "institution", "course"] as const) {
    if (body[k] === undefined) continue;
    const t = shortText(body[k], LIMITS[k], k);
    if ("error" in t) return Response.json({ error: t.error }, { status: 400 });
    extra[k] = t.value;
  }
  if (typeof body.persona === "string" && body.persona !== "" && !personaLabel(body.persona)) {
    return Response.json({ error: "opção de perfil desconhecida" }, { status: 400 });
  }
  // perfil rico (migration 041): áreas de ajuda, perfil aberto, quem deixa
  // recado e os projetos fixados. Tudo validado antes de gravar qualquer coisa.
  let helpOffer: AreaKey[] | undefined;
  let helpWant: AreaKey[] | undefined;
  for (const [key, field] of [["helpOffer", "posso ajudar"], ["helpWant", "quero ajuda"]] as const) {
    if (body[key] === undefined) continue;
    const parsed = parseAreas(body[key]);
    if ("error" in parsed) return Response.json({ error: `${field}: ${parsed.error}` }, { status: 400 });
    if (key === "helpOffer") helpOffer = parsed.value;
    else helpWant = parsed.value;
  }
  let publicProfile: boolean | undefined;
  if (body.publicProfile !== undefined) {
    if (typeof body.publicProfile !== "boolean") {
      return Response.json({ error: "perfil aberto: use true ou false" }, { status: 400 });
    }
    publicProfile = body.publicProfile;
  }
  let recadosFrom: RecadosFrom | undefined;
  if (body.recadosFrom !== undefined) {
    if (!isRecadosFrom(body.recadosFrom)) {
      return Response.json({ error: "quem pode deixar recado: conexoes, todos ou ninguem" }, { status: 400 });
    }
    recadosFrom = body.recadosFrom;
  }
  if (body.pins !== undefined) {
    if (!member) return Response.json({ error: "Unauthorized" }, { status: 401 });
    try {
      await setPins(member, body.pins);
    } catch (e) {
      return Response.json({ error: e instanceof Error ? e.message : "fixados inválidos" }, { status: 400 });
    }
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
    helpOffer,
    helpWant,
    publicProfile,
    recadosFrom,
  });
  if (member && Object.keys(extra).length > 0) await saveOnboarding(member.id, extra, false);
  // nome da conquista ("1ª campanha"), nunca o id interno ("debut")
  const newBadges = member ? (await checkBadges(member.id)).map((b) => b.name) : [];
  return Response.json({ ok: true, newBadges });
}

// LGPD art. 18 VI — excluir conta: apaga conteúdo pessoal, anonimiza o que
// sustenta contagem agregada e remove o usuário do Clerk. Exige confirmação.
export async function DELETE(req: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  if (body?.confirm !== "excluir") {
    return Response.json({ error: 'confirme com {"confirm":"excluir"}' }, { status: 400 });
  }
  const member = await getMemberByClerkId(userId);
  if (!member) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const clerkId = await deleteMemberData(member.id);
  if (clerkId) {
    try {
      await (await clerkClient()).users.deleteUser(clerkId);
    } catch (e) {
      // dados já anonimizados aqui; falha no Clerk fica no log pra repetir à mão
      console.error("[privacy] falha ao excluir usuário no Clerk", member.id, e);
    }
  }
  return Response.json({ deleted: true });
}
