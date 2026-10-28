import { currentMember } from "@/lib/session";
import { takeDownTestimonial, TestimonialError } from "@/lib/testimonials";

// Tirar do ar o conteúdo denunciado, direto da fila. Hoje só depoimento de
// time (migration 037): quem trata a denúncia (organização da edição,
// conduta, admin) muda o depoimento pra "removido" e as denúncias abertas
// dele saem resolvidas. 401, 403, 404, 400 (denúncia de outro tipo).

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentMember();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  if (!/^\d{1,12}$/.test(id)) return Response.json({ error: "Denúncia não encontrada." }, { status: 404 });
  try {
    await takeDownTestimonial(Number(id), me);
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof TestimonialError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
