import { auth } from "@clerk/nextjs/server";
import { getMemberByClerkId } from "@/lib/members";
import {
  listNotifications,
  markAllRead,
  markRead,
  unreadCount,
} from "@/lib/notifications";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const member = await getMemberByClerkId(userId);
  if (!member) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return Response.json({
    notifications: await listNotifications(member.id),
    unread: await unreadCount(member.id),
  });
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const member = await getMemberByClerkId(userId);
  if (!member) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  if (body?.action === "readAll") {
    await markAllRead(member.id);
    return Response.json({ ok: true });
  }
  if (Number.isInteger(body?.id) && body.id > 0) {
    await markRead(body.id, member.id);
    return Response.json({ ok: true });
  }
  return Response.json({ error: "Ação inválida" }, { status: 400 });
}
