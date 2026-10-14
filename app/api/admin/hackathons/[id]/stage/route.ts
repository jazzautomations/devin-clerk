import { auth } from "@clerk/nextjs/server";
import { getHackathon } from "@/lib/hackathons";
import { getMemberByClerkId } from "@/lib/members";
import { hasEditionRole } from "@/lib/roles";
import { getStageAdmin, runStageAction, StageError } from "@/lib/stage";
import { nudgeStage } from "@/lib/stageStream";

// Modo palco — controle da final (organizador e staff da edição; admin
// global vale). GET = estado do controle (fila, candidatos, ranking
// parcial). POST {action, ...} = uma ação; devolve o estado novo.
// 401 deslogado → 404 edição → 403 sem papel → 400 ação inválida →
// 409 transição impossível (fila vazia, palco já mudou, final encerrada).

type Ctx = { params: Promise<{ id: string }> };

async function guard(id: string): Promise<Response | null> {
  const { userId } = await auth();
  const member = userId ? await getMemberByClerkId(userId) : null;
  if (!member) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await getHackathon(id))) return Response.json({ error: "Edição não encontrada" }, { status: 404 });
  if (!(await hasEditionRole(member, id, "staff"))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const denied = await guard(id);
  if (denied) return denied;
  return Response.json(await getStageAdmin(id), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const denied = await guard(id);
  if (denied) return denied;
  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object" || Array.isArray(b)) {
    return Response.json({ error: "mande {action}" }, { status: 400 });
  }
  try {
    await runStageAction(id, b as Record<string, unknown>);
  } catch (e) {
    if (e instanceof StageError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
  nudgeStage(id);
  return Response.json(await getStageAdmin(id));
}
