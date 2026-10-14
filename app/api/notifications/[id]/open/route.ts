import { auth } from "@clerk/nextjs/server";
import { getMemberByClerkId } from "@/lib/members";
import { openNotification } from "@/lib/notifications";

// abrir a notificação (link da página /notificacoes, funciona sem JS):
// marca como lida e manda pro destino. Só caminho interno — nunca redirect
// aberto. Notificação de outra pessoa (ou inexistente) = 404.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  const member = userId ? await getMemberByClerkId(userId) : null;
  if (!member) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const id = Number((await params).id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const href = await openNotification(id, member.id);
  if (!href) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.redirect(new URL(href, req.url), 303);
}
