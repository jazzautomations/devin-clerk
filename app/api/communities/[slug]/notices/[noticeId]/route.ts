import { COMMUNITY_LIMITS, deleteNotice, updateNotice } from "@/lib/communities";
import { requireCommunityManager } from "@/lib/communityAuth";
import { limitOrNull } from "@/lib/ratelimit";

type Ctx = { params: Promise<{ slug: string; noticeId: string }> };

// Um aviso da comunidade (migration 046): PATCH edita o título e o texto,
// DELETE apaga. Dono e organizador; a ação fica no log de moderação.
// Editar não notifica de novo: quem recebeu o aviso vê o texto atualizado.

function parseNoticeId(raw: string): number | null {
  return /^\d{1,12}$/.test(raw) ? Number(raw) : null;
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { slug, noticeId } = await params;
  const g = await requireCommunityManager(slug);
  if ("response" in g) return g.response;
  const id = parseNoticeId(noticeId);
  if (id === null) return Response.json({ error: "Aviso não encontrado." }, { status: 404 });
  const limited = limitOrNull(req, "community-moderation", g.member.id);
  if (limited) return limited;
  const b = (await req.json().catch(() => null)) as { title?: unknown; body?: unknown } | null;
  const patch: { title?: string; body?: string } = {};
  if (typeof b?.title === "string") patch.title = b.title.trim();
  if (typeof b?.body === "string") patch.body = b.body.trim();
  if (Object.keys(patch).length === 0) return Response.json({ error: "Nada pra mudar no aviso." }, { status: 400 });
  if (patch.title !== undefined && (!patch.title || patch.title.length > COMMUNITY_LIMITS.noticeTitle)) {
    return Response.json({ error: `O título vai de 1 a ${COMMUNITY_LIMITS.noticeTitle} caracteres.` }, { status: 400 });
  }
  if (patch.body !== undefined && (!patch.body || patch.body.length > COMMUNITY_LIMITS.notice)) {
    return Response.json({ error: `O aviso vai de 1 a ${COMMUNITY_LIMITS.notice} caracteres.` }, { status: 400 });
  }
  const notice = await updateNotice(g.community.id, id, patch, g.member.id);
  if (!notice) return Response.json({ error: "Aviso não encontrado." }, { status: 404 });
  return Response.json({ notice });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const { slug, noticeId } = await params;
  const g = await requireCommunityManager(slug);
  if ("response" in g) return g.response;
  const id = parseNoticeId(noticeId);
  if (id === null) return Response.json({ error: "Aviso não encontrado." }, { status: 404 });
  const limited = limitOrNull(req, "community-moderation", g.member.id);
  if (limited) return limited;
  const removed = await deleteNotice(g.community.id, id, g.member.id);
  if (!removed) return Response.json({ error: "Aviso não encontrado." }, { status: 404 });
  return Response.json({ ok: true });
}
