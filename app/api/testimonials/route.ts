import { getMemberByUsername, resolveUsernameRedirect, type Member } from "@/lib/members";
import { limitOrNull } from "@/lib/ratelimit";
import { currentMember } from "@/lib/session";
import { assertCanWrite, cleanBody, writeTestimonial } from "@/lib/testimonials";
import { errorResponse, publicTestimonial, unauthorized } from "./http";

// Depoimento de time (migration 037).
// POST {username, hackathonId, body}: escreve sobre quem fez time com você
// naquela edição. 401 deslogado, 400 texto fora de 40–600, 403 sem time em
// comum, 404 pessoa que não existe ou bloqueio (em qualquer sentido), 409 já
// escreveu sobre ela nessa edição, 429 no sexto do dia.

async function resolve(raw: unknown): Promise<Member | null> {
  if (typeof raw !== "string") return null;
  const handle = raw.trim().replace(/^@/, "").toLowerCase();
  if (!handle || handle.length > 64) return null;
  const found = await getMemberByUsername(handle);
  if (found) return found;
  const moved = await resolveUsernameRedirect(handle);
  return moved ? getMemberByUsername(moved) : null;
}

export async function POST(req: Request) {
  const me = await currentMember();
  if (!me) return unauthorized();
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return Response.json({ error: "Corpo inválido." }, { status: 400 });
  const hackathonId = typeof b.hackathonId === "string" ? b.hackathonId.trim() : "";
  if (!hackathonId || hackathonId.length > 200) return Response.json({ error: "Escolha a edição." }, { status: 400 });
  const other = await resolve(b.username);
  if (!other) return Response.json({ error: "Pessoa não encontrada." }, { status: 404 });
  try {
    cleanBody(b.body);
    await assertCanWrite(me.id, other.id, hackathonId);
    // o limite conta tentativa válida: texto curto ou time errado não gasta o dia
    const limited = limitOrNull(req, "testimonials", me.id);
    if (limited) return limited;
    const t = await writeTestimonial(me.id, other.id, hackathonId, b.body);
    return Response.json({ ok: true, testimonial: publicTestimonial(t) }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
