import { auth } from "@clerk/nextjs/server";
import { getMemberByClerkId } from "@/lib/members";
import {
  createSubmission,
  listPendingSubmissions,
} from "@/lib/submissions";

// POST /api/submissions — porta PÚBLICA da comunidade (spec 026): indicar um
// hackathon não exige login. Abuso é freado pelo honeypot `company` (201
// silencioso) e pelo dedupe de 24h por url em createSubmission (200).
export async function POST(req: Request) {
  const b = (await req.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!b || typeof b !== "object") {
    return Response.json({ error: "body inválido" }, { status: 400 });
  }

  // honeypot — o form nunca pergunta empresa; bot que preenche recebe
  // sucesso falso e nada grava
  const company = typeof b.company === "string" ? b.company : "";
  if (company.trim()) {
    return Response.json({ ok: true }, { status: 201 });
  }

  try {
    const { submission, created } = createSubmission({
      name: b.name as string,
      url: b.url as string,
      startsAt: b.startsAt as string | undefined,
      location: b.location as string | undefined,
      format: b.format as string | undefined,
      note: b.note as string | undefined,
    });
    if (!created) {
      return Response.json(
        { submission, deduped: true },
        { status: 200 },
      );
    }
    return Response.json({ submission }, { status: 201 });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Erro" },
      { status: 400 },
    );
  }
}

// GET /api/submissions — fila de curadoria (pending), admin-only. A fila
// nunca é pública: deslogado → 401, membro → 403.
export async function GET() {
  const { userId } = await auth();
  const member = userId ? getMemberByClerkId(userId) : null;
  if (!member) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (member.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return Response.json({ submissions: listPendingSubmissions() });
}
