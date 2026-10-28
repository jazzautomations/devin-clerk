import { getCommunityBySlug } from "@/lib/communities";
import {
  createLead,
  LEAD_INTERESTS,
  LEAD_MESSAGE_MAX,
  type LeadInterest,
} from "@/lib/leads";
import { limitOrNull } from "@/lib/ratelimit";
import { isSupportKind } from "@/lib/supportKinds";

// POST /api/leads — porta comercial PÚBLICA (spec 022): a marca não loga pra
// dizer "quero patrocinar". Sem auth por desenho; abuso é freado por rate
// limit 5/h por IP (031), honeypot `website` (201 silencioso) e dedupe de
// 10min em createLead (200).
//
// migration 028: com `community` (slug) vira "quero apoiar esta comunidade":
// o lead fica ligado à comunidade, com o tipo de apoio (`supportKind`), e
// avisa o dono e os organizadores dela. Mesmo rate limit.
export async function POST(req: Request) {
  const limited = limitOrNull(req, "leads");
  if (limited) {
    return limited;
  }
  const b = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!b || typeof b !== "object") {
    return Response.json({ error: "body inválido" }, { status: 400 });
  }

  // honeypot — bot que preenche `website` recebe sucesso falso e nada grava
  const website = typeof b.website === "string" ? b.website : "";
  if (website.trim()) {
    return Response.json({ ok: true }, { status: 201 });
  }

  if (typeof b.company !== "string" || !b.company.trim()) {
    return Response.json(
      { error: "nome da empresa obrigatório" },
      { status: 400 },
    );
  }
  if (typeof b.email !== "string" || !b.email.trim()) {
    return Response.json({ error: "e-mail obrigatório" }, { status: 400 });
  }
  if (
    b.message !== undefined &&
    b.message !== null &&
    typeof b.message !== "string"
  ) {
    return Response.json({ error: "mensagem inválida" }, { status: 400 });
  }

  // apoio a uma comunidade: o interesse é sempre 'comunidade'
  let communityId: number | null = null;
  let interest: unknown = b.interest;
  if (b.community !== undefined && b.community !== null) {
    if (typeof b.community !== "string" || !b.community.trim()) {
      return Response.json({ error: "comunidade inválida" }, { status: 400 });
    }
    const c = await getCommunityBySlug(b.community.trim().toLowerCase());
    if (!c || c.hidden) {
      return Response.json({ error: "Comunidade não encontrada" }, { status: 404 });
    }
    if (b.supportKind !== undefined && b.supportKind !== null && !isSupportKind(b.supportKind)) {
      return Response.json({ error: "tipo de apoio inválido" }, { status: 400 });
    }
    if (typeof b.message === "string" && b.message.trim().length > LEAD_MESSAGE_MAX) {
      return Response.json({ error: `mensagem: até ${LEAD_MESSAGE_MAX} caracteres` }, { status: 400 });
    }
    communityId = c.id;
    interest = "comunidade";
  }
  if (
    typeof interest !== "string" ||
    !LEAD_INTERESTS.includes(interest as LeadInterest) ||
    (interest === "comunidade" && communityId === null)
  ) {
    return Response.json({ error: "interesse inválido" }, { status: 400 });
  }

  try {
    const { lead, created } = await createLead({
      company: b.company,
      email: b.email,
      interest: interest as LeadInterest,
      message: typeof b.message === "string" ? b.message : null,
      communityId,
      supportKind: communityId !== null && isSupportKind(b.supportKind) ? b.supportKind : null,
    });
    if (!created) {
      return Response.json({ lead, deduped: true }, { status: 200 });
    }
    return Response.json({ lead }, { status: 201 });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Erro" },
      { status: 400 },
    );
  }
}
