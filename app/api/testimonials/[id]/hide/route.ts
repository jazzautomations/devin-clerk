import { hideTestimonial } from "@/lib/testimonials";
import { actionGuard, errorResponse, type IdCtx } from "../../http";

// Quem recebeu tira do perfil um depoimento que já tinha aceitado. Ninguém é
// avisado; aceitar de novo traz de volta.

export async function POST(req: Request, ctx: IdCtx) {
  const g = await actionGuard(req, ctx);
  if ("response" in g) return g.response;
  try {
    const t = await hideTestimonial(g.id, g.me.id);
    return Response.json({ ok: true, status: t.status });
  } catch (e) {
    return errorResponse(e);
  }
}
