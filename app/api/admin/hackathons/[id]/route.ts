import { auth } from "@clerk/nextjs/server";
import { updateHackathon, type HackathonPatch } from "@/lib/admin";
import { getHackathon } from "@/lib/hackathons";
import { getMemberByClerkId } from "@/lib/members";

const FORMATS = ["online", "presencial", "hibrido"];

const bad = (msg: string) => Response.json({ error: msg }, { status: 400 });

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
  if (!getHackathon(id)) {
    return Response.json({ error: "Edição não encontrada" }, { status: 404 });
  }
  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object") {
    return bad("Body JSON obrigatório");
  }

  const patch: HackathonPatch = {};

  if ("name" in b) {
    if (typeof b.name !== "string" || !b.name.trim()) {
      return bad("name inválido");
    }
    patch.name = b.name;
  }
  if ("startsAt" in b) {
    if (typeof b.startsAt !== "string" || !b.startsAt) {
      return bad("startsAt inválido");
    }
    patch.startsAt = b.startsAt;
  }
  if ("format" in b) {
    if (!FORMATS.includes(b.format)) {
      return bad("format inválido");
    }
    patch.format = b.format;
  }
  if ("registrationUrl" in b) {
    if (typeof b.registrationUrl !== "string" || !b.registrationUrl.trim()) {
      return bad("registrationUrl inválido");
    }
    patch.registrationUrl = b.registrationUrl.trim();
  }
  // campos opcionais que aceitam null/vazio pra limpar
  for (const k of [
    "endsAt",
    "location",
    "registrationDeadline",
    "prize",
  ] as const) {
    if (k in b) {
      if (b[k] !== null && typeof b[k] !== "string") {
        return bad(`${k} inválido`);
      }
      patch[k] = typeof b[k] === "string" && b[k] ? b[k] : null;
    }
  }
  if ("tags" in b) {
    if (
      !Array.isArray(b.tags) ||
      b.tags.some((t: unknown) => typeof t !== "string")
    ) {
      return bad("tags deve ser array de strings");
    }
    patch.tags = b.tags;
  }
  if ("active" in b) {
    if (typeof b.active !== "boolean") {
      return bad("active deve ser booleano");
    }
    patch.active = b.active;
  }
  // spec 032 — edição curada: inscrição vira pedido pendente
  if ("requiresApproval" in b) {
    if (typeof b.requiresApproval !== "boolean") {
      return bad("requiresApproval deve ser booleano");
    }
    patch.requiresApproval = b.requiresApproval;
  }

  if (Object.keys(patch).length === 0) {
    return bad("Nenhum campo editável enviado");
  }

  const hackathon = updateHackathon(id, patch);
  return Response.json({ hackathon });
}
