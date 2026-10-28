import { canModerateChallenge, removeEntry, requireOpenChallenge } from "@/lib/openChallenges";

type Ctx = { params: Promise<{ id: string; entryId: string }> };

// Moderação tira a entrega de alguém (dono, organizador da comunidade ou
// admin). A linha fica com quem tirou e quando; quem entregou é avisado.
// A própria pessoa tira a dela em /entry.

export async function DELETE(_req: Request, { params }: Ctx) {
  const p = await params;
  const g = await requireOpenChallenge(p.id);
  if ("response" in g) return g.response;
  if (!(await canModerateChallenge(g.member, g.challenge))) return Response.json({ error: "Forbidden" }, { status: 403 });
  const entryId = /^\d{1,9}$/.test(p.entryId) ? Number(p.entryId) : NaN;
  const r = await removeEntry(g.challenge, entryId, g.member);
  if (!r) return Response.json({ error: "Entrega não encontrada." }, { status: 404 });
  return Response.json({ ok: true });
}
