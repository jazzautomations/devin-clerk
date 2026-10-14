import db from "@/lib/db";
import { getHackathon } from "@/lib/hackathons";
import { buildIcs, icsResponse } from "@/lib/ics";
import {
  hasScheduleAccess,
  listVisibleScheduleItems,
  resolveCalendarToken,
  scheduleViewerFor,
  toIcsEvent,
} from "@/lib/schedule";

// Feed .ics pessoal — sem login (app de calendário não tem sessão), por
// link assinado e revogável. Inclui os itens do papel/inscrição da pessoa
// calculados AGORA: perdeu o papel, some do feed na próxima sincronização.

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const notFound = () => new Response("Not found", { status: 404 });
  const t = await resolveCalendarToken(token.replace(/\.ics$/, ""));
  if (!t) return notFound();
  const [h, member] = await Promise.all([
    getHackathon(t.hackathonId),
    db.prepare("SELECT id, role FROM members WHERE id = ?").get<{ id: number; role: string }>(t.memberId),
  ]);
  if (!h || !member) return notFound();
  const viewer = await scheduleViewerFor(member, h.id);
  if (!hasScheduleAccess(viewer, viewer.status)) return notFound();
  const items = await listVisibleScheduleItems(h.id, viewer);
  const body = buildIcs({
    name: `${h.name} — minha programação`,
    refresh: true,
    events: items.map((i) => toIcsEvent(i, h)),
  });
  return icsResponse(body, `${h.id}-minha-programacao.ics`);
}
