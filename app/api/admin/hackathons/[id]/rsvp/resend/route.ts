import { requireEditionManager } from "@/lib/editionAuth";
import { resendRsvp } from "@/lib/rsvp";

// reenvio individual do convite/lembrete do RSVP pelo organizador
const ERROR_STATUS = { not_found: 404, not_invited: 409, closed: 409, cooldown: 429 } as const;
const ERROR_TEXT = {
  not_found: "inscrição aprovada não encontrada",
  not_invited: "essa pessoa ainda não foi convidada pro RSVP",
  closed: "prazo encerrado ou evento já começou",
  cooldown: "acabou de ser reenviado — espere alguns minutos",
} as const;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await requireEditionManager(id);
  if ("response" in g) return g.response;
  const b = (await req.json().catch(() => null)) as { memberId?: unknown } | null;
  const memberId = Number(b?.memberId);
  if (!Number.isSafeInteger(memberId) || memberId <= 0) {
    return Response.json({ error: "memberId inválido" }, { status: 400 });
  }
  const res = await resendRsvp(id, memberId);
  if (!res.ok) {
    return Response.json({ error: ERROR_TEXT[res.reason], reason: res.reason }, { status: ERROR_STATUS[res.reason] });
  }
  return Response.json(res);
}
