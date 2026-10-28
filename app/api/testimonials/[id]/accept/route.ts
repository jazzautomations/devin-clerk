import { acceptTestimonial, canWriteBack } from "@/lib/testimonials";
import { actionGuard, errorResponse, publicTestimonial, type IdCtx } from "../../http";

// Quem recebeu aceita: o depoimento vai pro perfil. Também traz de volta um
// recusado ou um escondido. O autor não é avisado (o perfil já mostra).
// writeBack: @ do autor quando dá pra escrever sobre ele também (a página
// sugere uma vez, sem cobrar).
// Corpo {body}: o texto que a tela mostrou. Se o autor trocou depois, 409
// "O texto mudou. Recarregue a página." e nada vai pro perfil. Sem body, 400.

export async function POST(req: Request, ctx: IdCtx) {
  const g = await actionGuard(req, ctx);
  if ("response" in g) return g.response;
  try {
    const b = (await req.json().catch(() => null)) as { body?: unknown } | null;
    const t = await acceptTestimonial(g.id, g.me.id, b?.body);
    const writeBack = (await canWriteBack(g.me.id, t.authorId)) ? t.author.username : null;
    return Response.json({ ok: true, status: t.status, testimonial: publicTestimonial(t), writeBack });
  } catch (e) {
    return errorResponse(e);
  }
}
