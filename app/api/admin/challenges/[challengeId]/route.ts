import { auth } from "@clerk/nextjs/server";
import {
  getChallenge,
  updateChallenge,
  type ChallengePatch,
} from "@/lib/challenges";
import { getMemberByClerkId } from "@/lib/members";

const bad = (msg: string) => Response.json({ error: msg }, { status: 400 });

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ challengeId: string }> },
) {
  const { userId } = await auth();
  const member = userId ? await getMemberByClerkId(userId) : null;
  if (!member) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (member.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const { challengeId } = await params;
  if (!await getChallenge(challengeId)) {
    return Response.json(
      { error: "Desafio não encontrado" },
      { status: 404 },
    );
  }
  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object") {
    return bad("Body JSON obrigatório");
  }

  const patch: ChallengePatch = {};

  for (const k of ["sponsor", "title"] as const) {
    if (k in b) {
      if (typeof b[k] !== "string" || !b[k].trim()) {
        return bad(`${k} inválido`);
      }
      patch[k] = b[k];
    }
  }
  // campos opcionais que aceitam null/vazio pra limpar
  for (const k of ["description", "prize"] as const) {
    if (k in b) {
      if (b[k] !== null && typeof b[k] !== "string") {
        return bad(`${k} inválido`);
      }
      patch[k] = typeof b[k] === "string" && b[k] ? b[k] : null;
    }
  }
  if ("sponsorId" in b) {
    if (b.sponsorId !== null && typeof b.sponsorId !== "string") {
      return bad("sponsorId inválido");
    }
    patch.sponsorId = b.sponsorId;
  }
  if ("active" in b) {
    if (typeof b.active !== "boolean") {
      return bad("active deve ser booleano");
    }
    patch.active = b.active;
  }

  if (Object.keys(patch).length === 0) {
    return bad("Nenhum campo editável enviado");
  }

  try {
    const challenge = await updateChallenge(challengeId, patch);
    return Response.json({ challenge });
  } catch (e) {
    return bad(e instanceof Error ? e.message : "Erro");
  }
}
