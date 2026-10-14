import { auth } from "@clerk/nextjs/server";
import { getHackathon } from "@/lib/hackathons";
import { buildIcs, icsResponse } from "@/lib/ics";
import { getMemberByClerkId } from "@/lib/members";
import { canSeeAudience, getScheduleItem, scheduleViewerFor, toIcsEvent } from "@/lib/schedule";

// .ics de um item: /h/[id]/programacao/12.ics. Item fechado (mentores,
// jurados…) exige sessão com o papel; pra quem não pode ver é 404, não 403
// — não confirma que o item existe.

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const { id, itemId } = await params;
  const m = /^(\d+)\.ics$/.exec(itemId);
  const notFound = () => new Response("Not found", { status: 404 });
  if (!m) return notFound();
  const [h, item] = await Promise.all([getHackathon(id), getScheduleItem(id, Number(m[1]))]);
  if (!h || !h.active || !item || !item.publishedAt) return notFound();
  if (item.audience !== "todos") {
    const { userId } = await auth();
    const member = userId ? await getMemberByClerkId(userId) : null;
    if (!canSeeAudience(item.audience, await scheduleViewerFor(member, id))) return notFound();
  }
  return icsResponse(buildIcs({ events: [toIcsEvent(item, h)] }), `${id}-${item.id}.ics`);
}
