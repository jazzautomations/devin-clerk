import { declineTestimonial } from "@/lib/testimonials";
import { actionGuard, errorResponse, type IdCtx } from "../../http";

// Quem recebeu recusa um pendente. Silencioso: o autor não é avisado e
// continua vendo "enviado".

export async function POST(req: Request, ctx: IdCtx) {
  const g = await actionGuard(req, ctx);
  if ("response" in g) return g.response;
  try {
    const t = await declineTestimonial(g.id, g.me.id);
    return Response.json({ ok: true, status: t.status });
  } catch (e) {
    return errorResponse(e);
  }
}
