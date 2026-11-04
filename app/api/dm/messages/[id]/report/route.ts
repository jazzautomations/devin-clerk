import { currentMember } from "@/lib/session";
import { createReport, ReportError } from "@/lib/reports";
import db from "@/lib/db";
import { unauthorized } from "../../../http";

// POST /api/dm/messages/[id]/report {reason}: denuncia UMA mensagem da
// conversa. A fila (reports, targetType 'dm') recebe só o snapshot daquela
// mensagem — ninguém lê o resto da DM, nem admin nem organizador. Se os
// dois lados estão numa edição rolando, a denúncia vira incidente lá
// (regra da Onda 0 em lib/reports.ts); fora de evento vai pro admin.
// Denunciar também bloqueia a pessoa pra quem denunciou.
// 404 pra mensagem de conversa alheia — fora do par ela não existe.

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await currentMember();
  if (!me) return unauthorized();
  const raw = (await ctx.params).id;
  const id = /^\d{1,12}$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(id) || id <= 0) return Response.json({ error: "Não encontrado." }, { status: 404 });
  // a denúncia só existe pra quem está na conversa (o resolveTarget 'dm'
  // confere de novo e devolve o snapshot)
  const mine = await db
    .prepare(
      `SELECT EXISTS (
         SELECT 1 FROM dm_messages dm JOIN dm_threads t ON t.id = dm."threadId"
         WHERE dm.id = @id AND (t."memberId" = @me OR t."peerId" = @me)) AS x`,
    )
    .get<{ x: boolean }>({ id, me: me.id });
  if (!mine?.x) return Response.json({ error: "Não encontrado." }, { status: 404 });
  const b = (await req.json().catch(() => null)) as { reason?: unknown } | null;
  try {
    const r = await createReport({
      targetType: "dm",
      targetId: id,
      reporterId: me.id,
      reporterRole: me.role,
      reason: b?.reason,
    });
    return Response.json({ ok: true, id: r.id, blocked: r.blocked }, { status: 201 });
  } catch (e) {
    if (e instanceof ReportError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
