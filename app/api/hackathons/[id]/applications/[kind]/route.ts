import { auth } from "@clerk/nextjs/server";
import { getHackathon } from "@/lib/hackathons";
import { getMemberByClerkId } from "@/lib/members";
import { limitOrNull } from "@/lib/ratelimit";
import {
  applyForRole,
  getMyApplications,
  isApplicationKind,
  withdrawApplication,
  type ApplyError,
} from "@/lib/roleApplications";

// frente E (spec 033) — candidatura a voluntário/mentor/jurado numa edição.
// POST { consent, answers } candidata; GET devolve o status; DELETE retira a
// pendente. Deslogado → 401 JSON (nunca redirect).

type Ctx = { params: Promise<{ id: string; kind: string }> };

const STATUS: Record<ApplyError, number> = {
  edition_not_found: 404,
  edition_over: 400,
  kind_closed: 403,
  conflict_participant: 409,
  already_has_role: 409,
  duplicate: 409,
  consent_required: 400,
  invalid_answer: 400,
};

async function resolve(ctx: Ctx) {
  const { userId } = await auth();
  if (!userId) return { res: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  const { id, kind } = await ctx.params;
  const h = await getHackathon(id);
  if (!h || !h.active || !isApplicationKind(kind)) {
    return { res: Response.json({ error: "Not found" }, { status: 404 }) };
  }
  const member = await getMemberByClerkId(userId);
  if (!member) return { res: Response.json({ error: "Member not found" }, { status: 404 }) };
  return { member, hackathonId: h.id, kind };
}

export async function GET(_req: Request, ctx: Ctx) {
  const r = await resolve(ctx);
  if ("res" in r) return r.res;
  const mine = await getMyApplications(r.member.id, r.hackathonId);
  return Response.json({ kind: r.kind, status: mine[r.kind] ?? null });
}

export async function POST(req: Request, ctx: Ctx) {
  const r = await resolve(ctx);
  if ("res" in r) return r.res;
  const limited = limitOrNull(req, "applications", r.member.id);
  if (limited) return limited;
  const body = (await req.json().catch(() => null)) as { consent?: unknown; answers?: unknown } | null;
  const result = await applyForRole({
    memberId: r.member.id,
    hackathonId: r.hackathonId,
    kind: r.kind,
    answers: body?.answers,
    consent: body?.consent === true,
    ip: clientIp(req),
  });
  if (!result.ok) {
    return Response.json(
      {
        error: result.error,
        message: result.message ?? null,
        questionId: result.questionId ?? null,
        status: result.status ?? null,
      },
      { status: STATUS[result.error] },
    );
  }
  return Response.json({ id: result.id, kind: r.kind, status: result.status }, { status: 201 });
}

export async function DELETE(req: Request, ctx: Ctx) {
  const r = await resolve(ctx);
  if ("res" in r) return r.res;
  const limited = limitOrNull(req, "applications", r.member.id);
  if (limited) return limited;
  const out = await withdrawApplication(r.member.id, r.hackathonId, r.kind);
  if (out === "not_found") return Response.json({ error: "Candidatura não encontrada" }, { status: 404 });
  if (out === "already_reviewed") {
    return Response.json({ error: "candidatura já decidida não pode ser retirada" }, { status: 409 });
  }
  return Response.json({ kind: r.kind, status: null });
}

// IP do consentimento: 1º salto do x-forwarded-for (Caddy na frente) ou x-real-ip
function clientIp(req: Request): string | null {
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || req.headers.get("x-real-ip") || null;
}
