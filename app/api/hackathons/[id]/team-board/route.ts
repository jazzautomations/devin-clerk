import { auth } from "@clerk/nextjs/server";
import { getHackathon, isOver } from "@/lib/hackathons";
import { getMemberByClerkId } from "@/lib/members";
import { hasEditionRole } from "@/lib/roles";
import { getRegistrationIds } from "@/lib/registrations";
import {
  deactivateBoardEntry,
  getBoardEntryById,
  hasContact,
  isMinorAtEdition,
  listBoardEntries,
  setBoardEntryActive,
  upsertBoardEntry,
  validateBoardInput,
} from "@/lib/teamboard";
import { XP } from "@/lib/game";
import { awardXp, checkBadges } from "@/lib/xp";
import { limitOrNull } from "@/lib/ratelimit";

const NOT_APPROVED = "só quem tem inscrição aprovada nesta edição pode fazer isso";

// leitura pública — o board é vitrine/prova social; anunciar exige inscrição.
// A nota (disponibilidade etc.) só aparece pra quem tem inscrição aprovada na
// edição; ninguém recebe o memberId.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const h = await getHackathon(id);
  if (!h || !h.active) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const { userId } = await auth();
  const member = userId ? await getMemberByClerkId(userId) : null;
  const withNotes = !!member && (await getRegistrationIds(member.id)).includes(h.id);
  return Response.json({ entries: await listBoardEntries(h.id, { withNotes }) });
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
  const h = await getHackathon(id);
  if (!h || !h.active) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const member = await getMemberByClerkId(userId);
  if (!member) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  // spec 031 — reanunciar em loop é freado por membro (10/h)
  const limited = limitOrNull(req, "team-board", member.id);
  if (limited) {
    return limited;
  }
  // sem inscrição o board vira spam — FR-002
  if (!(await getRegistrationIds(member.id)).includes(h.id)) {
    return Response.json({ error: NOT_APPROVED }, { status: 403 });
  }
  if (isOver(h)) {
    return Response.json({ error: "esta edição já terminou" }, { status: 409 });
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
  // menor de idade na data do evento não publica telefone nem e-mail
  if (hasContact(input.note) && (await isMinorAtEdition(member.id, h.id))) {
    return Response.json(
      { error: "tire o telefone e o e-mail da nota; quem se interessar chama você pelo perfil" },
      { status: 400 },
    );
  }
  const { entry, created } = await upsertBoardEntry(member.id, h.id, input);
  if (created) {
    await awardXp(member.id, XP.teamBoard);
    await checkBadges(member.id);
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
  const h = await getHackathon(id);
  if (!h || !h.active) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const member = await getMemberByClerkId(userId);
  if (!member) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  await deactivateBoardEntry(member.id, h.id);
  return Response.json({ active: false });
}

// moderação do board (FR-008): esconde/reativa qualquer anúncio da edição.
// Admin global e organizador da edição (hasEditionRole) — a moderação nova
// não fica só na mão do admin (spec 046 onda 3).
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  const member = userId ? await getMemberByClerkId(userId) : null;
  if (!member) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const h = await getHackathon(id);
  if (!h) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (!(await hasEditionRole(member, h.id, "organizador"))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
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
  const target = await getBoardEntryById(entryId);
  if (!target || target.hackathonId !== h.id) {
    return Response.json({ error: "Anúncio não encontrado" }, { status: 404 });
  }
  const entry = await setBoardEntryActive(entryId, b.active);
  return Response.json({ entry });
}
