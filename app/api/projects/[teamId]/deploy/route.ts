import { auth } from "@clerk/nextjs/server";
import { getMemberByClerkId } from "@/lib/members";
import {
  canDeploy,
  getDeployForTeam,
  getLatestDeployForTeam,
  logTail,
  projectExists,
  queueDeploy,
  stopDeploy,
  sweepDeploys,
} from "@/lib/deploys";

type Ctx = { params: Promise<{ teamId: string }> };

async function gate(ctx: Ctx) {
  const { userId } = await auth();
  const member = userId ? getMemberByClerkId(userId) : null;
  if (!member) return { err: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  const teamId = Number((await ctx.params).teamId);
  if (!Number.isInteger(teamId) || !projectExists(teamId))
    return { err: Response.json({ error: "Projeto não encontrado" }, { status: 404 }) };
  if (!canDeploy(member, teamId))
    return { err: Response.json({ error: "Forbidden" }, { status: 403 }) };
  return { teamId };
}

export async function POST(req: Request, ctx: Ctx) {
  const g = await gate(ctx);
  if ("err" in g) return g.err;
  const body = await req.json().catch(() => ({}));
  try {
    sweepDeploys();
    const deploy = queueDeploy({
      teamId: g.teamId,
      repoUrl: body.repoUrl,
      startCommand: body.startCommand,
      byUsername: "",
    });
    return Response.json({ deploy, url: `/demo/${deploy.id}/` }, { status: 202 });
  } catch (e) {
    const msg = (e as Error).message;
    const status = /já existe/i.test(msg) ? 409 : /limite/i.test(msg) ? 429 : /desativad/i.test(msg) ? 503 : 400;
    return Response.json({ error: msg }, { status });
  }
}

export async function GET(_req: Request, ctx: Ctx) {
  const g = await gate(ctx);
  if ("err" in g) return g.err;
  sweepDeploys();
  const deploy = getLatestDeployForTeam(g.teamId);
  return Response.json({
    deploy,
    url: deploy ? `/demo/${deploy.id}/` : null,
    logTail: deploy ? logTail(deploy.id) : "",
  });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const g = await gate(ctx);
  if ("err" in g) return g.err;
  const deploy = getDeployForTeam(g.teamId);
  if (!deploy)
    return Response.json({ error: "Nenhum deploy ativo" }, { status: 404 });
  stopDeploy(deploy.id);
  return Response.json({ ok: true });
}
