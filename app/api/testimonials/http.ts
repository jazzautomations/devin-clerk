import { limitOrNull } from "@/lib/ratelimit";
import { currentMember } from "@/lib/session";
import { TestimonialError, type Testimonial } from "@/lib/testimonials";
import type { Member } from "@/lib/members";

// Pedaços comuns das rotas de depoimento (migration 037). Não é rota: o Next
// só serve arquivos route.ts.

export type IdCtx = { params: Promise<{ id: string }> };

export const unauthorized = () => Response.json({ error: "Unauthorized" }, { status: 401 });

export function errorResponse(e: unknown): Response {
  if (e instanceof TestimonialError) return Response.json({ error: e.message }, { status: e.status });
  throw e;
}

/** o que a API devolve de um depoimento (sem e-mail nem nada além do perfil) */
export function publicTestimonial(t: Testimonial) {
  return {
    id: t.id,
    body: t.body,
    hackathonId: t.hackathonId,
    hackathonName: t.hackathonName,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    author: { username: t.author.username, name: t.author.name },
    member: { username: t.member.username, name: t.member.name },
  };
}

/**
 * Membro logado + id válido + balde "testimonial-actions". Devolve a
 * Response de erro pronta ou {me, id}.
 */
export async function actionGuard(req: Request, ctx: IdCtx): Promise<{ response: Response } | { me: Member; id: number }> {
  const me = await currentMember();
  if (!me) return { response: unauthorized() };
  const raw = (await ctx.params).id;
  const id = /^\d{1,12}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(id) || id <= 0) return { response: Response.json({ error: "Depoimento não encontrado." }, { status: 404 }) };
  const limited = limitOrNull(req, "testimonial-actions", me.id);
  if (limited) return { response: limited };
  return { me, id };
}
