import { deleteDraft, meetupErrorResponse, parseMeetupInput, requireMeetup, updateMeetup } from "@/lib/meetups";
import { limitOrNull } from "@/lib/ratelimit";

type Ctx = { params: Promise<{ id: string }> };

// PATCH: edita (dono/organizador). Mudou o horário de um publicado, quem
// respondeu recebe o aviso. Divide o limite diário com criar.
export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const g = await requireMeetup(id, "manage");
  if ("response" in g) return g.response;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return Response.json({ error: "corpo da requisição inválido" }, { status: 400 });
  const limited = limitOrNull(req, "meetups", g.member.id);
  if (limited) return limited;
  const parsed = parseMeetupInput(b, { current: g.meetup });
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });
  try {
    const r = await updateMeetup(g.meetup, g.member.id, parsed.value);
    return Response.json({ id: g.meetup.id, href: `/agenda/${g.meetup.id}`, ...r });
  } catch (e) {
    return meetupErrorResponse(e);
  }
}

// DELETE: apaga rascunho (publicado só cancela)
export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const g = await requireMeetup(id, "manage");
  if ("response" in g) return g.response;
  try {
    await deleteDraft(g.meetup);
    return Response.json({ deleted: true, href: `/comunidade/${g.meetup.communitySlug}/agenda` });
  } catch (e) {
    return meetupErrorResponse(e);
  }
}
