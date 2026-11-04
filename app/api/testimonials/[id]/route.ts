import { deleteTestimonial, editTestimonial } from "@/lib/testimonials";
import { actionGuard, errorResponse, publicTestimonial, type IdCtx } from "../http";

// PATCH {body}: o autor troca o texto. Se estava aceito, volta pra pendente e
// a pessoa decide de novo. DELETE: o autor retira o depoimento.
// 401, 403 (quem recebeu tentando editar), 404 (não existe, não é seu ou
// bloqueio), 400 texto fora de 40–600, 429.

export async function PATCH(req: Request, ctx: IdCtx) {
  const g = await actionGuard(req, ctx);
  if ("response" in g) return g.response;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return Response.json({ error: "Corpo inválido." }, { status: 400 });
  try {
    const t = await editTestimonial(g.id, g.me.id, b.body);
    return Response.json({ ok: true, testimonial: publicTestimonial(t), publicStatus: t.status === "aceito" ? "no perfil" : "enviado" });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function DELETE(req: Request, ctx: IdCtx) {
  const g = await actionGuard(req, ctx);
  if ("response" in g) return g.response;
  try {
    await deleteTestimonial(g.id, g.me.id);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
