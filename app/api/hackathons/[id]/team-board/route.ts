import { auth } from "@clerk/nextjs/server";
import { getHackathon } from "@/lib/hackathons";
import { getMemberByClerkId } from "@/lib/members";
import { getRegistrationIds } from "@/lib/registrations";
import {
  deactivateBoardEntry,
  getBoardEntryById,
  listBoardEntries,
  setBoardEntryActive,
  upsertBoardEntry,
  validateBoardInput,
} from "@/lib/teamboard";
import { XP } from "@/lib/game";
import { awardXp, checkBadges } from "@/lib/xp";
import { limitOrNull } from "@/lib/ratelimit";

// leitura pública — o board é vitrine/prova social; anunciar exige inscrição
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const h = getHackathon(id);
  if (!h || !h.active) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json({ entries: listBoardEntries(h.id) });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const h = getHackathon(id);
  if (!h || !h.active) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const member = getMemberByClerkId(userId);
  if (!member) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  // spec 031 — reanunciar em loop é freado por membro (10/h)
  const limited = limitOrNull(req, "team-board", member.id);
  if (limited) {
    return limited;
  }
  // sem inscrição o board vira spam — FR-002
  if (!getRegistrationIds(member.id).includes(h.id)) {
    return Response.json({ error: "inscreve-te primeiro" }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  let input;
  try {
    input = validateBoardInput(body ?? {});
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Anúncio inválido" },
      { status: 400 },
    );
  }
  const { entry, created } = upsertBoardEntry(member.id, h.id, input);
  if (created) {
    awardXp(member.id, XP.teamBoard);
    checkBadges(member.id);
  }
  return Response.json(
    { entry, created, xp: created ? `+${XP.teamBoard}` : null },
    { status: created ? 201 : 200 },
  );
}

// o membro fecha o próprio anúncio quando o time se forma — idempotente
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const h = getHackathon(id);
  if (!h || !h.active) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const member = getMemberByClerkId(userId);
  if (!member) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  deactivateBoardEntry(member.id, h.id);
  return Response.json({ active: false });
}

// moderação admin (FR-008): esconde/reativa qualquer anúncio da edição
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  const member = userId ? getMemberByClerkId(userId) : null;
  if (!member) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (member.role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const h = getHackathon(id);
  if (!h) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const b = await req.json().catch(() => null);
  const entryId =
    b && typeof b.entryId === "number" && Number.isInteger(b.entryId)
      ? b.entryId
      : null;
  if (!entryId || typeof b?.active !== "boolean") {
    return Response.json(
      { error: "entryId + active (booleano) obrigatórios" },
      { status: 400 },
    );
  }
  const target = getBoardEntryById(entryId);
  if (!target || target.hackathonId !== h.id) {
    return Response.json({ error: "Anúncio não encontrado" }, { status: 404 });
  }
  const entry = setBoardEntryActive(entryId, b.active);
  return Response.json({ entry });
}
