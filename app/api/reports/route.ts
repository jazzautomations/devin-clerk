import { getCommunityBySlug } from "@/lib/communities";
import { getHackathon } from "@/lib/hackathons";
import { limitOrNull } from "@/lib/ratelimit";
import { canHandleReport, createReport, listReports, REPORT_TARGETS, ReportError, type ReportScope, type ReportTarget } from "@/lib/reports";
import { currentMember } from "@/lib/session";

// Denúncia numa fila só (migration 032).
// POST {targetType, targetId, reason}: qualquer membro logado, 5 por hora.
// GET  ?comunidade=slug | ?edicao=id | (nada = fila do admin), com
//      ?status=open|resolved e ?tipo=post|comment|member|…: quem modera o espaço.

export async function POST(req: Request) {
  const me = await currentMember();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const limited = limitOrNull(req, "reports", me.id);
  if (limited) return limited;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b || typeof b !== "object") return Response.json({ error: "Corpo inválido." }, { status: 400 });
  try {
    const r = await createReport({ targetType: b.targetType, targetId: b.targetId, reporterId: me.id, reason: b.reason });
    return Response.json({ ok: true, id: r.id, blocked: r.blocked }, { status: 201 });
  } catch (e) {
    if (e instanceof ReportError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

export async function GET(req: Request) {
  const me = await currentMember();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const slug = sp.get("comunidade");
  const edition = sp.get("edicao");
  let scope: ReportScope = { global: true };
  if (slug) {
    const c = await getCommunityBySlug(slug);
    if (!c || (c.hidden && me.role !== "admin")) return Response.json({ error: "Comunidade não encontrada" }, { status: 404 });
    scope = { communityId: c.id };
    if (!(await canHandleReport(me, { communityId: c.id, hackathonId: null }))) return Response.json({ error: "Forbidden" }, { status: 403 });
  } else if (edition) {
    const h = await getHackathon(edition);
    if (!h) return Response.json({ error: "Edição não encontrada" }, { status: 404 });
    scope = { hackathonId: h.id };
    if (!(await canHandleReport(me, { communityId: null, hackathonId: h.id }))) return Response.json({ error: "Forbidden" }, { status: 403 });
  } else if (me.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const tipo = sp.get("tipo");
  const type = tipo && (REPORT_TARGETS as readonly string[]).includes(tipo) ? (tipo as ReportTarget) : null;
  const status = sp.get("status") === "resolved" ? "resolved" : "open";
  return Response.json({ reports: await listReports(scope, { status, type }) });
}
