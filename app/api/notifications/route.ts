import { auth } from "@clerk/nextjs/server";
import { getMemberByClerkId } from "@/lib/members";
import {
  listNotifications,
  listNotificationsGrouped,
  markAllRead,
  markRead,
  unreadCount,
} from "@/lib/notifications";

// GET: o sino e o "mais" do /notificacoes. `groups` é a lista agrupada
// (migration 040): 8 por padrão (dropdown), `limite` até 30, `antes` é o
// cursor (id da cabeça do último grupo) e `aba=mencoes` filtra menções.
// `notifications` (lista crua) continua pra quem já lia o formato antigo.
export async function GET(req?: Request) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const member = await getMemberByClerkId(userId);
  if (!member) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const q = req ? new URL(req.url).searchParams : new URLSearchParams();
  const antesN = Number(q.get("antes"));
  const antes = Number.isSafeInteger(antesN) && antesN > 0 ? antesN : null;
  const limiteN = Number(q.get("limite"));
  const limite = Number.isInteger(limiteN) && limiteN > 0 ? Math.min(30, limiteN) : 8;
  const only = q.get("aba") === "mencoes" ? ("mencoes" as const) : undefined;
  const [notifications, unread, grouped] = await Promise.all([
    antes === null && !only ? listNotifications(member.id) : Promise.resolve([]),
    unreadCount(member.id),
    listNotificationsGrouped(member.id, antes, limite, { only }),
  ]);
  return Response.json({ notifications, unread, groups: grouped.items, next: grouped.next });
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
  // {id}: marca essa; com group: true (o sino), o grupo inteiro dela
  if (Number.isSafeInteger(body?.id) && body.id > 0) {
    await markRead(body.id, member.id, { group: body.group === true });
    return Response.json({ ok: true });
  }
  return Response.json({ error: "Ação inválida" }, { status: 400 });
}
