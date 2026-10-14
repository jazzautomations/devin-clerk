import { auth } from "@clerk/nextjs/server";
import { after } from "next/server";
import { getHackathon } from "@/lib/hackathons";
import { getMemberByClerkId } from "@/lib/members";
import { canManageEdition } from "@/lib/roles";
import {
  listAnnouncementsForAdmin,
  processDeliveries,
  publishAnnouncement,
  validateAnnouncementInput,
} from "@/lib/announcements";

// spec 033 US2 — publicar aviso da edição (organizador/admin). A resposta
// volta assim que o fan-out está na fila; o envio roda em after().

async function guard(id: string) {
  const { userId } = await auth();
  const member = userId ? await getMemberByClerkId(userId) : null;
  if (!member) return { error: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!(await canManageEdition(member, id))) {
    return { error: Response.json({ error: "Forbidden" }, { status: 403 }) };
  }
  if (!(await getHackathon(id))) {
    return { error: Response.json({ error: "Edição não encontrada" }, { status: 404 }) };
  }
  return { member };
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guard(id);
  if (g.error) return g.error;
  return Response.json({ announcements: await listAnnouncementsForAdmin(id) });
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guard(id);
  if (g.error) return g.error;
  const raw = await req.json().catch(() => null);
  let input;
  try {
    input = validateAnnouncementInput(raw);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
  let published;
  try {
    published = await publishAnnouncement(id, g.member.id, input);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "time não é desta edição") return Response.json({ error: msg }, { status: 400 });
    throw e;
  }
  after(async () => {
    try {
      // o lote cobre a edição inteira na maioria dos casos; o resto o cron pega
      await processDeliveries(500);
    } catch (e) {
      console.error("[announcements] worker pós-publicação falhou", e);
    }
  });
  return Response.json(published);
}
