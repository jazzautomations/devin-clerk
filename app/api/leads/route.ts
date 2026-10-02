import {
  createLead,
  LEAD_INTERESTS,
  type LeadInterest,
} from "@/lib/leads";

// POST /api/leads — porta comercial PÚBLICA (spec 022): a marca não loga pra
// dizer "quero patrocinar". Sem auth por desenho; abuso é freado pelo honeypot
// `website` (201 silencioso) e pelo dedupe de 10min em createLead (200).
export async function POST(req: Request) {
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
    typeof b.interest !== "string" ||
    !LEAD_INTERESTS.includes(b.interest as LeadInterest)
  ) {
    return Response.json({ error: "interesse inválido" }, { status: 400 });
  }
  if (
    b.message !== undefined &&
    b.message !== null &&
    typeof b.message !== "string"
  ) {
    return Response.json({ error: "mensagem inválida" }, { status: 400 });
  }

  try {
    const { lead, created } = createLead({
      company: b.company,
      email: b.email,
      interest: b.interest as LeadInterest,
      message: typeof b.message === "string" ? b.message : null,
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
