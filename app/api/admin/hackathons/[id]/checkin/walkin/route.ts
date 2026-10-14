import { checkinCounts, formatCheckinTime } from "@/lib/checkins";
import { limitOrNull } from "@/lib/ratelimit";
import { formatSp } from "@/lib/rsvp";
import { requireEditionStaff } from "@/lib/staffAuth";
import { listWalkInCandidates, walkIn } from "@/lib/walkin";

// Quem chegou sem vaga (035 #6): GET ?q= lista a fila de espera (sem
// e-mail); POST {registrationId} aprova e faz o check-in na hora, se a sala
// ainda tem lugar (presentes < capacidade) e se é o dia do evento — ver
// lib/walkin.ts. Pedido pendente fica com o organizador.
const HOUR = 3_600_000;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await requireEditionStaff(id);
  if ("response" in g) return g.response;
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return Response.json({ results: await listWalkInCandidates(id, q) });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await requireEditionStaff(id);
  if ("response" in g) return g.response;
  const limited = limitOrNull(req, "checkin-walkin", g.member.id, { limit: 120, windowMs: HOUR });
  if (limited) return limited;
  const b = (await req.json().catch(() => null)) as { registrationId?: unknown } | null;
  if (typeof b?.registrationId !== "number") {
    return Response.json({ error: "mande {registrationId}" }, { status: 400 });
  }
  const r = await walkIn(id, b.registrationId, g.member.id);
  if (!r.ok) {
    switch (r.reason) {
      case "not_found":
        return Response.json({ error: "Inscrição não encontrada nesta edição." }, { status: 404 });
      case "rejected":
        return Response.json({ error: "Inscrição recusada: a entrada não está liberada." }, { status: 409 });
      case "pending":
        return Response.json(
          { error: "Pedido ainda não aprovado. Quem decide é a organização, na aba inscritos." },
          { status: 409 },
        );
      case "outside_window":
        return Response.json(
          {
            error: `Fora do horário do evento: a entrada abre na véspera (${formatSp(r.window.start)}) e fecha 2 dias depois do fim (${formatSp(r.window.end)}).`,
          },
          { status: 409 },
        );
      case "already_approved":
        return Response.json(
          { error: "Já está aprovado. Use o check-in normal (QR ou busca)." },
          { status: 409 },
        );
      case "full":
        return Response.json(
          { error: `Sala cheia: ${r.present} presentes para ${r.capacity} vagas.` },
          { status: 409 },
        );
    }
  }
  const label = r.name ?? `@${r.username}`;
  return Response.json({
    registrationId: r.registrationId,
    username: r.username,
    name: r.name,
    at: r.at,
    message: `${label} saiu da fila de espera e entrou às ${formatCheckinTime(r.at)}.`,
    counts: await checkinCounts(id),
  });
}
