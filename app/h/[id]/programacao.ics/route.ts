import { getHackathon } from "@/lib/hackathons";
import { buildIcs, icsResponse } from "@/lib/ics";
import { ANON_VIEWER, listVisibleScheduleItems, toIcsEvent } from "@/lib/schedule";

// Feed iCal público da edição: só itens publicados abertos a todos. Quem
// tem papel/inscrição assina o feed pessoal (/api/me/calendar/[token].ics).

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const h = await getHackathon(id);
  if (!h || !h.active) return new Response("Not found", { status: 404 });
  const items = await listVisibleScheduleItems(id, ANON_VIEWER);
  const body = buildIcs({
    name: `${h.name} — programação`,
    refresh: true,
    events: items.map((i) => toIcsEvent(i, h)),
  });
  return icsResponse(body, `${id}-programacao.ics`);
}
