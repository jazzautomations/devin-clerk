import { canManageCommunity } from "@/lib/communities";
import { icsResponse } from "@/lib/ics";
import { canSeeMeetup, getMeetup, meetupIcs, meetupIdParam } from "@/lib/meetups";
import { currentMember } from "@/lib/session";

// .ics de um evento da agenda (logado; o proxy manda quem não tem conta pro
// cadastro). Horário em UTC no arquivo, o app de agenda mostra no fuso do
// aparelho. O link da sala não entra: fica na página, pra quem respondeu.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const member = await currentMember();
  if (!member) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const mid = meetupIdParam(id);
  const m = mid ? await getMeetup(mid) : null;
  if (!m || !canSeeMeetup(m, member, await canManageCommunity(member, m.communityId))) {
    return new Response("Not found", { status: 404 });
  }
  if (m.cancelledAt) return new Response("Evento cancelado", { status: 410 });
  return icsResponse(meetupIcs(m), `agenda-${m.id}.ics`);
}
