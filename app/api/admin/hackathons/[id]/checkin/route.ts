import { auth } from "@clerk/nextjs/server";
import { getHackathon } from "@/lib/hackathons";
import { getMemberByClerkId, type Member } from "@/lib/members";
import { hasEditionRole } from "@/lib/roles";
import {
  checkIn,
  checkinCounts,
  formatCheckinTime,
  searchRegistrants,
} from "@/lib/checkins";

// Check-in no dia (spec 033 US4). POST {token} (QR lido) ou
// {registrationId} (busca manual) marca presença; repetir é 200 com
// "já fez check-in às HH:MM". GET ?q= é a busca manual + contador ao vivo.
// Staff e organizador da edição (e admin global).

type Guard = { member: Member } | { res: Response };

async function guard(id: string): Promise<Guard> {
  const { userId } = await auth();
  const member = userId ? await getMemberByClerkId(userId) : null;
  if (!member) return { res: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!(await getHackathon(id))) {
    return { res: Response.json({ error: "Edição não encontrada" }, { status: 404 }) };
  }
  if (!(await hasEditionRole(member, id, "staff"))) {
    return { res: Response.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { member };
}

const label = (r: { name: string | null; username: string }) => r.name ?? `@${r.username}`;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guard(id);
  if ("res" in g) return g.res;
  const q = new URL(req.url).searchParams.get("q") ?? "";
  const [results, counts] = await Promise.all([searchRegistrants(id, q), checkinCounts(id)]);
  return Response.json({ results, counts });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guard(id);
  if ("res" in g) return g.res;

  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  let by: { token: string } | { registrationId: number } | null = null;
  if (b && typeof b.token === "string") by = { token: b.token.trim() };
  else if (b && typeof b.registrationId === "number") by = { registrationId: b.registrationId };
  if (!by) {
    return Response.json({ error: "mande {token} do QR ou {registrationId}" }, { status: 400 });
  }

  const r = await checkIn(id, by, g.member.id);
  if (!r.ok) {
    switch (r.reason) {
      case "invalid":
        return Response.json({ error: "Isso não é um ingresso do HackaHub." }, { status: 400 });
      case "not_found":
        return Response.json(
          { error: "Ingresso não reconhecido nesta edição (de outra edição ou inválido)." },
          { status: 404 },
        );
      case "pending":
        return Response.json(
          { error: `${label(r)} tem pedido de inscrição pendente — aprove antes de liberar a entrada.` },
          { status: 409 },
        );
      case "waitlist":
        return Response.json(
          { error: `${label(r)} está na fila de espera — sem vaga confirmada, sem entrada.` },
          { status: 409 },
        );
      case "rejected":
        return Response.json(
          { error: `A inscrição de ${label(r)} foi recusada — entrada não liberada.` },
          { status: 409 },
        );
    }
  }

  const hhmm = formatCheckinTime(r.at);
  return Response.json({
    already: r.already,
    at: r.at,
    registrationId: r.registrationId,
    username: r.username,
    name: r.name,
    message: r.already
      ? `${label(r)} já fez check-in às ${hhmm}.`
      : `Check-in feito: ${label(r)} às ${hhmm}.`,
    counts: await checkinCounts(id),
  });
}
