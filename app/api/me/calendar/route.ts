import { auth } from "@clerk/nextjs/server";
import { getHackathon } from "@/lib/hackathons";
import { getMemberByClerkId } from "@/lib/members";
import { absoluteUrl } from "@/lib/seo";
import {
  calendarTokenFor,
  hasScheduleAccess,
  personalFeedPath,
  rotateCalendarToken,
  scheduleViewerFor,
} from "@/lib/schedule";

// Link do feed pessoal da edição (?h=<id>). GET devolve o vigente; DELETE
// revoga e devolve um novo (link vazou, trocou de celular…).

async function guard(req: Request): Promise<{ res: Response } | { member: { id: number }; id: string }> {
  const { userId } = await auth();
  const member = userId ? await getMemberByClerkId(userId) : null;
  if (!member) return { res: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  const id = new URL(req.url).searchParams.get("h") ?? "";
  const h = id ? await getHackathon(id) : null;
  if (!h) return { res: Response.json({ error: "Edição não encontrada" }, { status: 404 }) };
  const viewer = await scheduleViewerFor(member, id);
  if (!hasScheduleAccess(viewer, viewer.status)) {
    return { res: Response.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { member, id };
}

const payload = (token: string) => {
  const url = absoluteUrl(personalFeedPath(token));
  return { url, webcal: url.replace(/^https?:/, "webcal:") };
};

export async function GET(req: Request) {
  const g = await guard(req);
  if ("res" in g) return g.res;
  return Response.json(payload(await calendarTokenFor(g.member.id, g.id)));
}

export async function DELETE(req: Request) {
  const g = await guard(req);
  if ("res" in g) return g.res;
  return Response.json(payload(await rotateCalendarToken(g.member.id, g.id)));
}
